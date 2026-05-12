export interface SearchResultText {
  blockId: string;
  blockLength: number;
  matchStart: number;
  page: number;
  sentence: string;
}

export interface SearchResult {
  index: number;
  text: SearchResultText[];
  title: string;
}

export interface ReaderMenuSearchSessionState {
  keyword: string;
  searchResult: SearchResult[];
  searchResultScrollTop: number;
  showSearchResult: boolean;
}

export interface SearchResultTarget {
  blockId?: string;
  matchStart?: number;
  page: number;
}
