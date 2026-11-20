import unittest

from cache_probe_join import losses, trigger, ts


def msg(t, read, write=20000, role='assistant'):
    return {'type': 'message', 'timestamp': t, 'message': {'role': role, 'usage': {'cacheRead': read, 'cacheWrite': write,
                                                                                    'cost': {'total': 0.5}}}}


class Join(unittest.TestCase):
    def test_first_call_is_not_a_loss_and_triggers_are_classified(self):
        lines = [msg('2026-11-13T10:00:00Z', 0),                     # primeira chamada: não conta
                 msg('2026-11-13T10:01:00Z', 9000),                  # leu cache
                 {'type': 'compaction'}, msg('2026-11-13T10:02:00Z', 0),
                 msg('2026-11-13T10:12:00Z', 0)]                     # sem evento, sonda com tools mudadas
        probes = [(ts('2026-11-13T10:12:00Z'), {'toolsChanged': True})]
        rows = losses(lines, probes, '2026-11-13')
        self.assertEqual([r['trigger'] for r in rows], ['compaction', 'tools_changed'])
        self.assertEqual(rows[1]['gap_min'], 10.0)

    def test_small_write_and_before_since_are_ignored(self):
        lines = [msg('2026-11-12T10:00:00Z', 1), msg('2026-11-12T10:05:00Z', 0), msg('2026-11-13T10:00:00Z', 0, 100)]
        self.assertEqual(losses(lines, [], '2026-11-13'), [])

    def test_identical_prefix_is_provider_side(self):
        self.assertEqual(trigger([], {'toolsChanged': False, 'systemChanged': False, 'firstDiff': None}), 'provider')
        self.assertEqual(trigger([], None), 'unknown')
        self.assertEqual(trigger(['model_change:'], {'toolsChanged': True}), 'model_change')


if __name__ == '__main__':
    unittest.main()
