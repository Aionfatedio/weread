import { t } from '@/locales';
import './index.scss';

export const Loading = (): React.JSX.Element => (
  <div className="w-full h-full flex justify-center items-center pb-8" role="status" aria-label={t('common.loading')}>
    <div className="loading-cubes" aria-hidden="true">
      {[2, 3, 4, 1, 2, 3, 0, 1, 2].map((delay, index) => (
        <span key={index} style={{ animationDelay: `${delay * 100}ms` }} />
      ))}
    </div>
  </div>
);
