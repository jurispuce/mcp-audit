/** Outline icon paths on a 24px grid (Lucide-compatible style), as used in the design previews. */
export const ICONS = {
	home: 'M4 11l8-7 8 7v9H4z',
	setup: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
	plan: 'M5 6h14v14H5zM5 10h14M9 3v4M15 3v4',
	run: 'M7 5l12 7-12 7z',
	findings: 'M6 5h12v15H6zM9 12l2 2 4-4',
	library: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z',
	settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM4 12h2M18 12h2M12 4v2M12 18v2',
	spark: 'M12 3v6M12 15v6M3 12h6M15 12h6',
	back: 'M15 5l-7 7 7 7',
	close: 'M6 6l12 12M18 6L6 18',
	list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
	signout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
	search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4'
} as const;
export type IconName = keyof typeof ICONS;
