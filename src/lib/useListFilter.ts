import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/** The parts of a filter every list on the desk has in common. */
export interface ListFilterBase {
  page: number;
  pageSize?: number;
  sort?: string;
  descending?: boolean;
  search?: string;
}

/** A filter with nothing empty in it: the core is asked only what was set. */
function prune<F extends object>(filter: F): F {
  const kept = Object.entries(filter).filter(([, value]) => value !== "" && value !== undefined);
  return Object.fromEntries(kept) as F;
}

/**
 * The state behind a list screen: what is being asked for, and how it changes.
 *
 * Every list here had its own copy of this, and each copy had the same three
 * faults — the search box read the address once at mount and then ignored it,
 * so the global search did nothing on the screen the operator was already on;
 * sorting kept the page number, landing them in the middle of a new order; and
 * an emptied box sent `""` rather than dropping the filter it no longer shows.
 * Changing a filter always returns to the first page, because page 4 of the old
 * question is not page 4 of the new one.
 */
export function useListFilter<F extends ListFilterBase>(
  initial: F,
  options: { searchParam?: string; debounceMs?: number } = {},
) {
  const { searchParam = "q", debounceMs = 250 } = options;
  const [params] = useSearchParams();
  const fromAddress = params.get(searchParam) ?? "";

  const [filter, setFilterState] = useState<F>(() =>
    prune({ ...initial, search: fromAddress || undefined }),
  );
  const [searchText, setSearchText] = useState(fromAddress);
  const asked = useRef(fromAddress);

  // Changing what is asked returns to the first page unless the caller is the
  // pager itself: page 4 of the old question is not page 4 of the new one.
  const setFilter = useCallback((patch: Partial<F>) => {
    setFilterState((current) => prune({ ...current, page: 1, ...patch }));
  }, []);

  // A search from the header arrives in the address bar, and it has to land
  // even when this screen is already the one on show.
  useEffect(() => {
    if (fromAddress === asked.current) return;
    asked.current = fromAddress;
    setSearchText(fromAddress);
    setFilter({ search: fromAddress, page: 1 } as Partial<F>);
  }, [fromAddress, setFilter]);

  // Typing is debounced, but a box that already says what was asked says
  // nothing again: without this every list asks the core twice on arrival.
  useEffect(() => {
    if (searchText === asked.current) return;
    const timer = window.setTimeout(() => {
      asked.current = searchText;
      setFilter({ search: searchText, page: 1 } as Partial<F>);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [searchText, debounceMs, setFilter]);

  /** Sort by a column, turning the order around when it is already sorted. */
  const sortBy = useCallback((key: string) => {
    setFilterState((current) =>
      prune({
        ...current,
        sort: key,
        descending: current.sort === key ? !current.descending : false,
        page: 1,
      }),
    );
  }, []);

  const goToPage = useCallback((page: number) => {
    setFilterState((current) => prune({ ...current, page }));
  }, []);

  return { filter, setFilter, searchText, setSearchText, sortBy, goToPage };
}
