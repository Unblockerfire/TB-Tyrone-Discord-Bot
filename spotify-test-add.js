// spotify-test-add.js
require("dotenv").config();
const { addTrackToPlaylist } = require("./commands/spotify");

(async () => {
  try {
    const playlistId = process.env.SPOTIFY_PLAYLIST_ID;
    if (!playlistId) {
      console.error("Missing SPOTIFY_PLAYLIST_ID in .env");
      process.exit(1);
    }

    // Spotify’s famous test track from docs
    const testTrackUri = "spotify:track:11dFghVXANMlKmJXsNCbNl";

    console.log("Trying to add test track to playlist:");
    console.log("  Playlist:", playlistId);
    console.log("  Track:", testTrackUri);

    const res = await addTrackToPlaylist(playlistId, testTrackUri);
    console.log("SUCCESS, Spotify response:");
    console.dir(res, { depth: null });
  } catch (err) {
    console.error("Test add error:", err);
  }
})();

