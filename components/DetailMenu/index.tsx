import { Catalogue } from '@/components/Catalogue';
import { ReaderMenuSearch } from '@/components/DetailMenu/ReaderMenuSearch';
export { clearBookDetailMenuSearchState, requestBookDetailMenuSearch } from '@/components/DetailMenu/searchSession';

export const BookDetailMenu = (): React.JSX.Element => <ReaderMenuSearch idleContent={<Catalogue />} />;
