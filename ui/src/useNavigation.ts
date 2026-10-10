import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  capturePosition,
  positionKey,
  readPosition,
  restorePosition,
  ViewPositions,
} from './navigation.js';
import { parseRoute, patchRoute, routeSearch, type Route } from './state.js';

/** One bounded position history is shared by page links and browser navigation. */
export function useNavigation(
  route: Route,
  setRoute: (route: Route) => void,
  closeOverlays: () => void,
) {
  const positions = useRef(new ViewPositions()),
    current = useRef(route),
    close = useRef(closeOverlays);
  current.current = route;
  close.current = closeOverlays;
  const key = positionKey(route);
  useLayoutEffect(() => {
    const position = positions.current.read(route) ?? readPosition(history.state?.wombatPosition);
    if (position) return restorePosition(position);
  }, [key]);
  useEffect(() => {
    const prior = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const capture = () =>
      capturePosition(!!(current.current.configId || current.current.suggestion));
    const save = () => {
      const position = capture();
      positions.current.save(current.current, position);
      history.replaceState({ wombatPosition: position }, '');
    };
    const pop = () => {
      positions.current.save(current.current, capture());
      const next = parseRoute(location.search),
        saved = readPosition(history.state?.wombatPosition);
      if (saved) positions.current.save(next, saved);
      setRoute(next);
      close.current();
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('pagehide', save);
      history.scrollRestoration = prior;
    };
  }, [setRoute]);
  return (patch: Partial<Route>) => {
    const position = capturePosition(!!(current.current.configId || current.current.suggestion));
    positions.current.save(current.current, position);
    history.replaceState({ wombatPosition: position }, '');
    const next = patchRoute(current.current, patch);
    history.pushState({ wombatPosition: positions.current.read(next) }, '', routeSearch(next));
    setRoute(next);
    close.current();
  };
}
