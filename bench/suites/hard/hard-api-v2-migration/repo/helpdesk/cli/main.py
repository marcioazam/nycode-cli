"""python3 -m helpdesk.cli.main <submit|search|report> <tickets.json> [criteria-json]."""

import json
import sys
from datetime import date

from helpdesk.desk import Desk
from helpdesk.errors import HelpdeskError

USAGE = "usage: helpdesk submit|report <tickets.json> | search <tickets.json> [criteria-json]"


def _load(path, today):
    desk = Desk()
    with open(path, encoding="utf-8") as handle:
        for data in json.load(handle):
            desk.submit(data, today)
    return desk


def main(argv=None, out=None, today=None):
    """0 ok, 1 uso incorreto, 2 erro nos dados."""
    out = sys.stdout if out is None else out
    args = list(sys.argv[1:] if argv is None else argv)
    today = date.today() if today is None else today
    if len(args) < 2 or args[0] not in ("submit", "search", "report"):
        print(USAGE, file=out)
        return 1
    try:
        if args[0] == "submit":
            desk = Desk()
            with open(args[1], encoding="utf-8") as handle:
                results = [desk.submit(data, today) for data in json.load(handle)]
            print(json.dumps(results, sort_keys=True), file=out)
        elif args[0] == "search":
            desk = _load(args[1], today)
            criteria = json.loads(args[2]) if len(args) > 2 else None
            print(json.dumps(desk.search(criteria), sort_keys=True), file=out)
        else:
            print(json.dumps(_load(args[1], today).report(), sort_keys=True), file=out)
    except (HelpdeskError, ValueError, OSError) as exc:
        print("error: " + str(exc), file=out)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
