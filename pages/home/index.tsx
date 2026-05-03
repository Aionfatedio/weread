import { type SVGProps, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { debounce } from 'ranuts/utils';
import { BookCard } from '@/components/BookCard';
import { addBook, getAllBooks, searchBooksByAuthor, searchBooksByContent, searchBooksByTitle } from '@/store/books';
import { checkEncoding, createReader, trim } from '@/lib/transformText';
import { resumeDB } from '@/store';
import { startSpaViewTransition } from '@/lib/navigation';
import { BOOKS_ADD_BY_DEFAULT, ensampleConfigs } from '@/lib/ensample';
import type { EnBook } from '@/lib/ensample';
import type { BookInfo, SearchResult } from '@/store/books';
import { ROUTE_PATH } from '@/router';
import { DEVICE_ENUM, useCheckDevice } from '@/lib/hooks';
import { Loading } from '@/components/Loading';
import { t } from '@/locales';
import 'ranui/input';

const DESKTOP_INPUT_STYLE = {
  '--ran-input-border-radius': '2rem',
  '--ran-input-content-border-radius': '2rem',
  '--ran-input-content-padding': '10px 10px 10px 52px',
  '--ran-input-content-font-size': '16px',
  '--ran-input-content-font-weight': '400',
};

const HomeSearchIcon = (props: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
      <path d="m21 21l-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </g>
  </svg>
);

const HomePlusIcon = (props: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M5 12h14m-7-7v14"
    />
  </svg>
);

const HomeArrowRightIcon = (props: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="m9 18l6-6l-6-6"
    />
  </svg>
);

const HomeSearchEmptyIcon = (props: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
      <path d="m13.5 8.5l-5 5m0-5l5 5" />
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21l-4.3-4.3" />
    </g>
  </svg>
);

const addBookByFile = () => {
  return new Promise((resolve, reject) => {
    const uploadFile = document.createElement('input');
    uploadFile.setAttribute('type', 'file');
    uploadFile.click();
    uploadFile.onchange = () => {
      const { files = [] } = uploadFile;
      if (files && files?.length > 0) {
        const [file] = files;
        createReader(file).then((result) => {
          addBook({
            title: file.name,
            encoding: checkEncoding(new Uint8Array(result)),
            content: result,
          }).then((res) => {
            if (!res.error) {
              resolve(res.data as BookInfo);
            } else {
              reject(res.error);
            }
          });
        });
      }
    };
  });
};

const addBookByUrl = ({ url, title, image, author }: EnBook) => {
  return new Promise((resolve, reject) => {
    fetch(url).then((response) => {
      response.blob().then((blob) => {
        const file = new File([blob], title, { type: blob.type });
        createReader(file).then((result) => {
          addBook({
            title: file.name,
            encoding: checkEncoding(new Uint8Array(result)),
            content: result,
            image,
            author,
          }).then((res) => {
            if (!res.error) {
              resolve(res.data as BookInfo);
            } else {
              reject(res.error);
            }
          });
        });
      });
    });
  });
};

export const Home = (): React.JSX.Element => {
  const [currentDevice] = useCheckDevice();
  if (currentDevice === DEVICE_ENUM.MOBILE) return <MobileHome />;
  if (currentDevice === DEVICE_ENUM.DESKTOP) return <DesktopHome />;
  return <Loading />;
};

export const DesktopHome = (): React.JSX.Element => {
  const navigate = useNavigate();
  const [bookList, setBookList] = useState<BookInfo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchValue, setSearchValue] = useState<string>('');
  const searchResultRef = useRef<HTMLDivElement>(null);
  const [searchTitleResult, setSearchTitleResult] = useState<BookInfo[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchAuthorResult, setSearchAuthorResult] = useState<BookInfo[]>([]);
  const [searchContentResult, setSearchContentResult] = useState<SearchResult[]>([]);

  const add = () => {
    addBookByFile().then((res) => {
      bookList.push(res as BookInfo);
      setBookList([...bookList]);
    });
  };

  const addFromUrl = async ({ url, title, image, author }: EnBook) => {
    addBookByUrl({ url, title, image, author }).then((res) => {
      bookList.push(res as BookInfo);
      setBookList([...bookList]);
    });
  };

  const getBooks = () => {
    getAllBooks<BookInfo>()
      .then((res) => {
        if (!res.error) {
          setBookList(res.data);
        } else {
          resumeDB().then(() => {
            getBooks();
          });
        }
      })
      .catch(() => {
        resumeDB().then(() => {
          getBooks();
        });
      });
  };

  const clearSearchResult = () => {
    setSearchTitleResult([]);
    setSearchAuthorResult([]);
    setSearchContentResult([]);
  };

  const onChange = debounce((e: Event) => {
    const value = trim((e.target as HTMLInputElement)?.value || '');
    setSearchValue(value);
    setSearchLoading(true);
    if (!value) {
      setSearchLoading(false);
      return;
    }
    clearSearchResult();
    // 搜索功能
    // 1. 搜索书的标题（分页 3 条）
    // 2. 搜索书的作者（分页 3 条）
    // 3. 搜索书内容（分页 3 条）
    searchBooksByTitle<BookInfo>(value).then((res) => {
      if (!res.error) {
        setSearchTitleResult(res.data);
      }
      setTimeout(() => {
        setSearchLoading(false);
      }, 500);
    });
    searchBooksByAuthor<BookInfo>(value).then((res) => {
      if (!res.error) {
        setSearchAuthorResult(res.data);
      }
      setTimeout(() => {
        setSearchLoading(false);
      }, 500);
    });
    searchBooksByContent<SearchResult>(value).then((res) => {
      if (!res.error) {
        setSearchContentResult(res.data);
      }
      setTimeout(() => {
        setSearchLoading(false);
      }, 500);
    });
  }, 500);

  const handleNativeClick = (e: MouseEvent) => {
    const target = e.target as HTMLDivElement;
    const id = target.getAttribute('item-id');
    if (id) {
      startSpaViewTransition(() => {
        navigate(`${ROUTE_PATH.BOOK_DETAIL}?id=${id}`);
      });
    }
  };

  useEffect(() => {
    // 默认添加的书籍，只添加一次
    if (!window.localStorage.getItem(BOOKS_ADD_BY_DEFAULT)) {
      ensampleConfigs.forEach((config: EnBook) => {
        addFromUrl(config);
      });
      window.localStorage.setItem(BOOKS_ADD_BY_DEFAULT, 'true');
    }
    // 查询所有书籍，进行展示
    getBooks();
    // 监听搜索框的 change 事件
    inputRef.current?.addEventListener('change', onChange);
    searchResultRef.current?.addEventListener('click', handleNativeClick);
    return () => {
      inputRef.current?.removeEventListener('change', onChange);
      searchResultRef.current?.removeEventListener('click', handleNativeClick);
    };
  }, []);

  return (
    <div>
      <div className="w-full bg-front-bg-color-2">
        <div className="w-full min-h-72 pt-28">
          <div className="relative w-1/2 min-w-2xs h-14 block mx-auto">
            <HomeSearchIcon
              className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-10"
              style={{ width: 24, height: 24, color: 'var(--icon-color-1)' }}
            />
            <r-input
              className="w-full h-full block mx-auto"
              style={DESKTOP_INPUT_STYLE}
              placeholder={t('search')}
              ref={inputRef}
            ></r-input>
          </div>
          <div
            className="w-full transition-all duration-500 overflow-hidden mt-6 pb-6"
            style={{ height: searchValue ? 'calc(100vh - var(--spacing) * 48)' : '0px' }}
            ref={searchResultRef}
          >
            <div className="overflow-y-auto h-full">
              {searchTitleResult.length > 0 && !searchLoading && (
                <div className="w-1/2 min-w-2xs block mx-auto bg-front-bg-color-3 rounded-xl py-5 mb-6">
                  <div>
                    <div className="text-text-color-2 text-base font-medium px-5 pb-1.5">{t('ebook')}</div>
                    <div>
                      {searchTitleResult.map((book) => {
                        const { title, author, image } = book;
                        const strList = title.split(searchValue) || [];
                        return (
                          <div
                            className="py-3.5 px-5 flex flex-row flex-nowrap items-center shrink-0 cursor-pointer hover:bg-blue-50 min-h-32"
                            key={book.id + 'title'}
                            item-id={book.id}
                          >
                            {image && <img className="w-16 mr-5" src={image} item-id={book.id} />}
                            <div>
                              <div className="text-lg text-text-color-1 font-medium break-all" item-id={book.id}>
                                {strList.map((item, index) => (
                                  <span key={item + index} item-id={book.id}>
                                    {item}
                                    {index === strList.length - 1 ? (
                                      ''
                                    ) : (
                                      <span item-id={book.id} className="text-blue-500">
                                        {searchValue}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                              <div className="text-base text-text-color-2 font-medium mt-1 break-all" item-id={book.id}>
                                {author}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {searchContentResult.length > 0 && !searchLoading && (
                <div className="w-1/2 min-w-2xs block mx-auto bg-front-bg-color-3 rounded-xl py-5">
                  <div>
                    <div className="text-text-color-2 text-base font-medium px-5 pb-1.5">
                      {t('search_result_1')} <span className="text-blue-500">{searchValue}</span> {t('search_result_2')}
                      {t('search_result_3')}
                      {searchContentResult.length}
                    </div>
                    <div>
                      {searchContentResult.map((book) => {
                        const { title, author, image, matchedText = [] } = book;
                        const [str] = matchedText || [];
                        const strList = str.split(searchValue) || [];
                        return (
                          <div
                            className="py-3.5 px-5 flex flex-row flex-nowrap items-center shrink-0 cursor-pointer hover:bg-blue-50 min-h-32"
                            key={book.id + 'content'}
                            item-id={book.id}
                          >
                            {image && <img className="w-16 mr-5" src={image} item-id={book.id} />}
                            <div>
                              <div className="text-lg text-text-color-1 font-medium break-all" item-id={book.id}>
                                {title}
                              </div>
                              <div className="text-base text-text-color-2 font-medium mt-1 break-all" item-id={book.id}>
                                {author}
                              </div>
                              <div className="text-base text-text-color-2 font-medium mt-1 break-all" item-id={book.id}>
                                {strList.map((item, index) => (
                                  <span key={item + index} item-id={book.id}>
                                    {item}
                                    {index === strList.length - 1 ? (
                                      ''
                                    ) : (
                                      <span item-id={book.id} className="text-blue-500">
                                        {searchValue}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {searchTitleResult.length === 0 &&
                searchAuthorResult.length === 0 &&
                searchContentResult.length === 0 &&
                !searchLoading && (
                  <div className="h-full">
                    <div className="flex flex-col items-center justify-center h-full">
                      <HomeSearchEmptyIcon className="text-text-color-2" style={{ width: 120, height: 120 }} />
                      <div className="text-text-color-2 font-normal text-xl">{t('no_result')}</div>
                    </div>
                  </div>
                )}
              {searchLoading && (
                <div className="h-full">
                  <div className="flex flex-col items-center justify-center h-full">
                    <r-loading
                      name="circle-fold"
                      className="text-2xl"
                      style={{
                        '--loading-circle-fold-item-before-background': 'var(--brand-blue-color-1)',
                        '--loading-circle-fold-item-after-background': 'var(--brand-blue-color-1)',
                      }}
                    ></r-loading>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {!searchValue && (
        <div className="w-full bg-front-bg-color-1 min-h-svh">
          <div className="max-w-7xl mx-auto pt-12 flex flex-row justify-between items-center">
            <div className="flex justify-start items-center">
              <div className="cursor-pointer text-text-color-1 text-2xl font-medium">{t('my_bookcase')}</div>
              <HomeArrowRightIcon
                className="cursor-pointer"
                style={{ width: 24, height: 24, color: 'var(--icon-color-1)' }}
              />
            </div>
          </div>
          <div className="max-w-7xl mx-auto flex flex-row flex-wrap justify-start items-center">
            <div className="w-2xs h-40 bg-front-bg-color-3 p-5 cursor-pointer justify-center rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5">
              <HomePlusIcon
                style={{ width: 64, height: 64, color: 'var(--icon-color-2)' }}
                onClick={add}
              />
            </div>
            {bookList.map((book) => (
              <BookCard book={book} key={book.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const MOBILE_INPUT_STYLE = {
  '--ran-input-border-radius': '2rem',
  '--ran-input-content-border-radius': '2rem',
  '--ran-input-content-padding': '10px 10px 10px 36px',
  '--ran-input-content-font-size': '16px',
  '--ran-input-content-font-weight': '400',
  '--ran-input-padding': '0px 10px',
};

export const MobileHome = (): React.JSX.Element => {
  const navigate = useNavigate();
  const [bookList, setBookList] = useState<BookInfo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchValue, setSearchValue] = useState<string>('');
  const searchResultRef = useRef<HTMLDivElement>(null);
  const [searchTitleResult, setSearchTitleResult] = useState<BookInfo[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchAuthorResult, setSearchAuthorResult] = useState<BookInfo[]>([]);
  const [searchContentResult, setSearchContentResult] = useState<SearchResult[]>([]);

  const add = () => {
    addBookByFile().then((res) => {
      bookList.push(res as BookInfo);
      setBookList([...bookList]);
    });
  };

  const addFromUrl = async ({ url, title, image, author }: EnBook) => {
    addBookByUrl({ url, title, image, author }).then((res) => {
      bookList.push(res as BookInfo);
      setBookList([...bookList]);
    });
  };

  const getBooks = () => {
    getAllBooks<BookInfo>()
      .then((res) => {
        if (!res.error) {
          setBookList(res.data);
        } else {
          resumeDB().then(() => {
            getBooks();
          });
        }
      })
      .catch(() => {
        resumeDB().then(() => {
          getBooks();
        });
      });
  };

  const clearSearchResult = () => {
    setSearchTitleResult([]);
    setSearchAuthorResult([]);
    setSearchContentResult([]);
  };

  const onChange = debounce((e: Event) => {
    const value = trim((e.target as HTMLInputElement)?.value || '');
    setSearchValue(value);
    setSearchLoading(true);
    if (!value) {
      setSearchLoading(false);
      return;
    }
    clearSearchResult();
    // 搜索功能
    // 1. 搜索书的标题（分页 3 条）
    // 2. 搜索书的作者（分页 3 条）
    // 3. 搜索书内容（分页 3 条）
    searchBooksByTitle<BookInfo>(value).then((res) => {
      if (!res.error) {
        setSearchTitleResult(res.data);
      }
      setTimeout(() => {
        setSearchLoading(false);
      }, 500);
    });
    searchBooksByAuthor<BookInfo>(value).then((res) => {
      if (!res.error) {
        setSearchAuthorResult(res.data);
      }
      setTimeout(() => {
        setSearchLoading(false);
      }, 500);
    });
    searchBooksByContent<SearchResult>(value).then((res) => {
      if (!res.error) {
        setSearchContentResult(res.data);
      }
      setTimeout(() => {
        setSearchLoading(false);
      }, 500);
    });
  }, 500);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const id = target.getAttribute('item-id');
    if (id) {
      startSpaViewTransition(() => {
        navigate(`${ROUTE_PATH.BOOK_DETAIL}?id=${id}`);
      });
    }
  };

  const handleNativeClick = (e: MouseEvent) => {
    const target = e.target as HTMLDivElement;
    const id = target.getAttribute('item-id');
    if (id) {
      startSpaViewTransition(() => {
        navigate(`${ROUTE_PATH.BOOK_DETAIL}?id=${id}`);
      });
    }
  };

  useEffect(() => {
    // 默认添加的书籍，只添加一次
    if (!window.localStorage.getItem(BOOKS_ADD_BY_DEFAULT)) {
      ensampleConfigs.forEach((config: EnBook) => {
        addFromUrl(config);
      });
      window.localStorage.setItem(BOOKS_ADD_BY_DEFAULT, 'true');
    }
    // 查询所有书籍，进行展示
    getBooks();
    // 监听搜索框的 change 事件
    inputRef.current?.addEventListener('change', onChange);
    searchResultRef.current?.addEventListener('click', handleNativeClick);
    return () => {
      inputRef.current?.removeEventListener('change', onChange);
      searchResultRef.current?.removeEventListener('click', handleNativeClick);
    };
  }, []);

  return (
    <div className="w-full min-h-svh bg-front-bg-color-2">
      <div className="p-5">
        <div className="relative w-full h-9 block mx-auto">
          <HomeSearchIcon
            className="absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none z-10"
            style={{ width: 16, height: 16, color: 'var(--icon-color-1)' }}
          />
          <r-input
            className="w-full h-full block mx-auto"
            style={MOBILE_INPUT_STYLE}
            placeholder={t('search')}
            ref={inputRef}
          ></r-input>
        </div>
      </div>
      {searchValue && (
        <div
          className="w-full transition-all duration-500 overflow-hidden pb-6"
          style={{ height: searchValue ? 'calc(100vh - var(--spacing) * 48)' : '0px' }}
          ref={searchResultRef}
          onClick={handleClick}
        >
          <div className="overflow-y-auto h-full px-5">
            {searchTitleResult.length > 0 && !searchLoading && (
              <div className="block mx-auto bg-front-bg-color-3 rounded-xl mb-6">
                <div>
                  <div className="text-text-color-2 text-base font-medium px-5 py-1.5">{t('ebook')}</div>
                  <div>
                    {searchTitleResult.map((book) => {
                      const { title, author, image } = book;
                      const strList = title.split(searchValue) || [];
                      return (
                        <div
                          className="py-3.5 px-5 flex flex-row flex-nowrap items-center shrink-0 cursor-pointer hover:bg-blue-50 min-h-32"
                          key={book.id + 'title'}
                          item-id={book.id}
                        >
                          {image && <img className="w-16 mr-5" src={image} item-id={book.id} />}
                          <div>
                            <div className="text-lg text-text-color-1 font-medium break-all" item-id={book.id}>
                              {strList.map((item, index) => (
                                <span key={item + index} item-id={book.id}>
                                  {item}
                                  {index === strList.length - 1 ? (
                                    ''
                                  ) : (
                                    <span item-id={book.id} className="text-blue-500">
                                      {searchValue}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                            <div className="text-base text-text-color-2 font-medium mt-1 break-all" item-id={book.id}>
                              {author}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {searchContentResult.length > 0 && !searchLoading && (
              <div className="block mx-auto bg-front-bg-color-3 rounded-xl py-5">
                <div>
                  <div className="text-text-color-2 text-base font-medium px-5 pb-1.5">
                    {t('search_result_1')} <span className="text-blue-500">{searchValue}</span> {t('search_result_2')} ·{' '}
                    {searchContentResult.length}
                  </div>
                  <div>
                    {searchContentResult.map((book) => {
                      const { title, author, image, matchedText = [] } = book;
                      const [str] = matchedText || [];
                      const strList = str.split(searchValue) || [];
                      return (
                        <div
                          className="py-3.5 px-5 flex flex-row flex-nowrap items-center shrink-0 cursor-pointer hover:bg-blue-50 min-h-32"
                          key={book.id + 'content'}
                          item-id={book.id}
                        >
                          {image && <img className="w-16 mr-5" src={image} item-id={book.id} />}
                          <div>
                            <div className="text-lg text-text-color-1 font-medium break-all" item-id={book.id}>
                              {title}
                            </div>
                            <div className="text-base text-text-color-2 font-medium mt-1 break-all" item-id={book.id}>
                              {author}
                            </div>
                            <div className="text-base text-text-color-2 font-medium mt-1 break-all" item-id={book.id}>
                              {strList.map((item, index) => (
                                <span key={item + index} item-id={book.id}>
                                  {item}
                                  {index === strList.length - 1 ? (
                                    ''
                                  ) : (
                                    <span item-id={book.id} className="text-blue-500">
                                      {searchValue}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {searchTitleResult.length === 0 &&
              searchAuthorResult.length === 0 &&
              searchContentResult.length === 0 &&
              !searchLoading && (
                <div className="h-full">
                  <div className="flex flex-col items-center justify-center h-full">
                    <HomeSearchEmptyIcon className="text-text-color-2" style={{ width: 120, height: 120 }} />
                    <div className="text-text-color-2 font-normal text-xl">{t('no_result')}</div>
                  </div>
                </div>
              )}
            {searchLoading && (
              <div className="h-full">
                <div className="flex flex-col items-center justify-center h-full">
                  <r-loading
                    name="circle-fold"
                    className="text-2xl"
                    style={{
                      '--loading-circle-fold-item-before-background': 'var(--brand-blue-color-1)',
                      '--loading-circle-fold-item-after-background': 'var(--brand-blue-color-1)',
                    }}
                  ></r-loading>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {!searchValue && (
        <div className="px-5">
          <div className="flex flex-row flex-wrap justify-start items-center">
            <div className="w-24 h-36 bg-front-bg-color-3 p-5 cursor-pointer justify-center rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5">
              <HomePlusIcon
                style={{ width: 54, height: 54, color: 'var(--icon-color-2)' }}
                onClick={add}
              />
            </div>
            {bookList.map((book) => (
              <BookCard book={book} key={book.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
