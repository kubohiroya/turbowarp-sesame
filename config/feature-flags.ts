/**
 * Safety-critical features are fixed when the extension bundle is built.
 * Keep remote lock control disabled in public/default builds.
 */
export const featureFlags = {
  sesameCommands: false,
} as const;
