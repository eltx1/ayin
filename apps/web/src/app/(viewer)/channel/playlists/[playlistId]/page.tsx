import { PlaylistEditor } from "@/components/playlist/playlist-editor";

export default async function ChannelPlaylistEditorPage({
  params,
}: {
  params: Promise<{ playlistId: string }>;
}) {
  const { playlistId } = await params;
  return <PlaylistEditor playlistId={playlistId} />;
}
