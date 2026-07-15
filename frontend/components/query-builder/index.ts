/**
 * Query editing components: the SQL editor, the Explore/SQL/Viz mode
 * selector, and the picker/chip primitives shared with the semantic explorer
 * (components/semantic-explorer — the semantic query surface). (The old
 * visual SQL builders — Full GUI and Simple tiers — were removed: unused in
 * production. Semantic + SQL are the only query surfaces; lib/semantic
 * handles detection/compilation.)
 */

export { QueryModeSelector, type QueryTab } from './QueryModeSelector';
export { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';
export { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
