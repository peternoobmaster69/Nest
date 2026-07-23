export const uiBreakpoints = {
  phoneMax: 600,
  tabletMax: 820,
  desktopMax: 1100,
  coarseLandscapeMaxWidth: 960,
  coarseLandscapeMaxHeight: 500,
} as const;

export const uiMedia = {
  phone: `(max-width: ${uiBreakpoints.phoneMax}px)`,
  tablet: `(max-width: ${uiBreakpoints.tabletMax}px)`,
  desktop: `(max-width: ${uiBreakpoints.desktopMax}px)`,
  coarseLandscape: `(max-width: ${uiBreakpoints.coarseLandscapeMaxWidth}px) and (max-height: ${uiBreakpoints.coarseLandscapeMaxHeight}px) and (pointer: coarse)`,
} as const;
