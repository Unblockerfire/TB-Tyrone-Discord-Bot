// debug-spotify-owner.js
require("dotenv").config();

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN,
  SPOTIFY_PLAYLIST_ID
} = process.env;

async function getAccessToken() {
  const auth = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${auth}`
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN
    })
  });

  const data = await res.json();
  if (!data.access_token) {
    console.error("Failed to get access token:", data);
    process.exit(1);
  }

  return data.access_token;
}

async function main() {
  const token = await getAccessToken();

  // Get the current user's profile
  const meRes = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const me = await meRes.json();

  console.log("Your Spotify user id =", me.id);
  console.log("");

  // Get playlist info
  const playlistRes = await fetch(
    `https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const playlist = await playlistRes.json();

  console.log("Playlist owner id =", playlist.owner?.id);
  console.log("Playlist name =", playlist.name);
  console.log("");

  if (playlistRes.status !== 200) {
    console.log("Playlist fetch error:", playlist);
    return;
  }

  if (playlist.owner.id === me.id) {
    console.log("✔ MATCH: Your refresh token belongs to the playlist owner.");
  } else {
    console.log("❌ MISMATCH: Your Spotify refresh token belongs to", me.id);
    console.log("But the playlist is owned by", playlist.owner.id);
    console.log("You must authenticate using the account that owns the playlist.");
  }
}

main().catch(console.error);
