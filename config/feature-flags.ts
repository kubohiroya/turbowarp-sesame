/**
 * Safety-critical features are fixed when the extension bundle is built.
 *
 * The default build keeps lock control off, so the extension file people load
 * by hand cannot send a command however a project is written. The standalone
 * app build turns it on deliberately, through the build-time constant below.
 *
 * This is a compile-time decision on purpose: nothing a project or a block
 * argument can say will change it, and an OFF build has no code path that
 * reaches a command.
 */

// Replaced at build time by Vite. Absent in the default build, where the
// typeof guard leaves the flag off.
declare const __SESAME_COMMANDS__: boolean;

export const featureFlags = {
  sesameCommands:
    typeof __SESAME_COMMANDS__ === "boolean" ? __SESAME_COMMANDS__ : false,
};
