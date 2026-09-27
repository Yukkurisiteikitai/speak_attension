export type SemanticRoleOption = {
  value: string; // one of the SemanticRole string values, e.g. "proposal"
  label: string; // Japanese display label, e.g. "提案"
};

type TimelineCorrectionMenuProps = {
  currentValue: string; // the currently-effective role (auto-classified or already-corrected)
  isCorrected: boolean; // true if this utterance has a manual correction applied
  options: SemanticRoleOption[]; // the full list of selectable roles, in display order
  onChange: (value: string) => void; // called with the new value when the person picks something
};

export function TimelineCorrectionMenu({
  currentValue,
  isCorrected,
  options,
  onChange,
}: TimelineCorrectionMenuProps) {
  return (
    <span className="timeline-correction-menu">
      <select
        aria-label="分類を修正"
        value={currentValue}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {isCorrected ? (
        <span className="timeline-correction-badge" title="手動で修正済み">
          修正済み
        </span>
      ) : null}
    </span>
  );
}
