import { useState } from 'react';

export interface FlyoutSelectorOption<T extends string = string> {
  id: T;
  label: string;
}

interface FlyoutSelectorProps<T extends string = string> {
  options?: Array<FlyoutSelectorOption<T>>;
  value: T;
  onChange?: (newId: T) => void;
}

const ITEM_HEIGHT = 36;

export const FlyoutSelector = <T extends string = string>({
  options = [],
  value,
  onChange,
}: FlyoutSelectorProps<T>): React.JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);
  const currentLabel = options.find((option) => option.id === value)?.label || '';
  const activeIndex = Math.max(0, options.findIndex((option) => option.id === value));
  const topOffset = -(activeIndex * ITEM_HEIGHT) - 1;

  return (
    <div className="flyout-selector relative text-sm w-12 h-[36px]">
      <button
        className={`flyout-selector-trigger flex items-center justify-center w-full h-full font-medium transition-colors ${
          isOpen ? 'opacity-0' : 'opacity-100'
        }`}
        type="button"
        onClick={() => setIsOpen(true)}
      >
        <span>{currentLabel}</span>
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" role="presentation" onClick={() => setIsOpen(false)} />
          <div
            className="flyout-selector-menu absolute left-0 w-full rounded-md z-50 overflow-hidden"
            style={{ top: `${topOffset}px` }}
          >
            {options.map((item) => (
              <button
                className="flyout-selector-item flex items-center justify-center w-full transition-colors"
                key={item.id}
                style={{ height: `${ITEM_HEIGHT}px` }}
                type="button"
                onClick={() => {
                  onChange?.(item.id);
                  setIsOpen(false);
                }}
              >
                <span className={value === item.id ? 'is-active' : ''}>{item.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
