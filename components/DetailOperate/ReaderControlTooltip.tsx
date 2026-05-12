export const ReaderControlTooltip = ({ label }: { label: string }): React.JSX.Element => (
  <div aria-hidden="true" className="reader-tooltip-item reader-tooltip-item-right">
    {label}
  </div>
);
