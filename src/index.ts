// Forge function handlers are declared from the src root as <module>.<export>.
// Keep implementation in backend/ while exposing stable manifest entrypoints.
export { handler, scanChunkHandler } from './backend/index';
