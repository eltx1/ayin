export type RemoteAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "select"
  | "back"
  | "play-pause"
  | "fast-forward"
  | "rewind"
  | "unknown";
const mapping: Record<string, RemoteAction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "select",
  Escape: "back",
  Backspace: "back",
  MediaPlayPause: "play-pause",
  MediaFastForward: "fast-forward",
  MediaRewind: "rewind",
};
const keyCodes: Record<number, RemoteAction> = {
  10009: "back",
  461: "back",
  415: "play-pause",
  19: "play-pause",
  417: "fast-forward",
  412: "rewind",
};
export function mapRemoteKey(key: string, keyCode?: number): RemoteAction {
  return mapping[key] ?? (keyCode === undefined ? "unknown" : (keyCodes[keyCode] ?? "unknown"));
}
