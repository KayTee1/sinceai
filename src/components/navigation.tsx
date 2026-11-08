"use client";

import { createContext, useCallback, useContext, useState } from "react";

// Lets any card (e.g. a decided proposal in chat) open a dashboard: the app
// switches to the Dashboard tab, Analytics catalog, with that asset selected.
// `n` changes on every request so opening the same asset twice still works.
export type AssetFocus = { assetId: string; n: number };

type Nav = { focus: AssetFocus | null; openAsset: (assetId: string) => void };

const NavContext = createContext<Nav>({ focus: null, openAsset: () => {} });

export const useNavigation = () => useContext(NavContext);

export function NavigationProvider({ onOpen, children }: { onOpen: () => void; children: React.ReactNode }) {
  const [focus, setFocus] = useState<AssetFocus | null>(null);
  const openAsset = useCallback(
    (assetId: string) => {
      setFocus((f) => ({ assetId, n: (f?.n ?? 0) + 1 }));
      onOpen();
    },
    [onOpen],
  );
  return <NavContext.Provider value={{ focus, openAsset }}>{children}</NavContext.Provider>;
}
