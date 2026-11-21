# fix-ui-behavior (round 2/2: Vim + transcript)

Reproduction: `PI_TEST_SDK_VERSION=1.5.2 … with-sdk.sh node --experimental-strip-types --test <files>` (SDK 1.5.2, no install).

## Failures and root causes
| Test | Cause | Fix |
|---|---|---|
| editor-vim: teclas nativas remapeadas | Test bug: `make()` positions the cursor with native Left after the custom keymap removed `cursorLeft`, so the cursor stayed at the end. | Build the editor first, then install the custom keymap. Assertions unchanged. |
| editor-vim: render real (wrapped) | Test obsolete: at 20 columns with 3 columns of padding the native editor scrolls (`↑ 1 more`), hiding the first row. | Render at 30 columns; assert no native scroll and all 8 words highlighted. |
| editor-vim: selection not painted | Product bug (`ui/editor.ts`): `VISUAL · seleção não exibida` needs more than the 40-column ruler, so `labeled()` fell back to the bare ruler and the warning vanished. | Add the warning alone as a shorter label candidate. |
| transcript: view render | Static-snapshot label adds 2 header lines (`SNAPSHOT`, blank); old index assumption obsolete. | Assert exact header lines (snapshot text truncated to width, blank) and `Você` at line 3. |
| transcript: navigation | From the top, `}` goes to prompt A (header precedes it); at the end scroll clamps, so B sits in the last page lines; End after Ctrl+E needs a redraw; help is truncated at 40 columns. | Assert A, then B (`['Você','  B']` at body lines 3–4), `{` back to A, "sem prompt anterior", full `linha 39` in expanded mode, full help line at 100 columns. |

## Receipts
Run: transcript.test.ts + editor-vim.test.ts + claude-compat/vim/test/*.test.ts → 334 tests, 334 pass, 0 fail (before: 3 + 2 failures). No git writes, no network, no SDK install. `claude-compat/vim/**` untouched (cause was not there).
