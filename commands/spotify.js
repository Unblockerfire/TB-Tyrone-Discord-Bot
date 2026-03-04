// commands/spotify.js
require("dotenv").config();

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

// If you STILL want to hard-code for Fly testing, you can do it here.
// For now I'm wiring it back to env so both local + Fly use the same source.
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
  console.warn(
    "[Spotify] Missing SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, or SPOTIFY_REFRESH_TOKEN in env"
  );
}

/**
 * Use the refresh token to get a fresh access token from Spotify.
 */
async function getAccessToken() {
  const basic = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN
    })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("[Spotify] Error getting access token:", data);
    throw new Error("Failed to refresh Spotify access token");
  }

  if (!data.access_token) {
    console.error("[Spotify] No access_token in response:", data);
    throw new Error("No access token returned from Spotify");
  }

  // Extra debug so we can see the scopes on Fly
  if (data.scope) {
    console.log("[Spotify] access token scope:", data.scope);
  } else {
    console.log("[Spotify] access token scope: <none reported>");
  }

  return data.access_token;
}

/**
 * Debug helper: log which Spotify user this token belongs to,
 * and who owns the playlist.
 */
async function debugIdentity(accessToken, playlistId) {
  try {
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const meData = await meRes.json();
    console.log("[Spotify debug] /me:", {
      id: meData.id,
      display_name: meData.display_name,
      email: meData.email
    });

    if (playlistId) {
      const plRes = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
      const plData = await plRes.json();
      console.log("[Spotify debug] playlist:", {
        id: plData.id,
        name: plData.name,
        owner: plData.owner
          ? {
              id: plData.owner.id,
              display_name: plData.owner.display_name,
              type: plData.owner.type
            }
          : null
      });
    }
  } catch (err) {
    console.error("[Spotify debug] failed identity debug:", err);
  }
}

/**
 * Search for the top track match given a text query.
 * Returns { name, artists[], uri, url } or null.
 */
async function searchTrack(query) {
  console.log("[Spotify] searchTrack called with:", query);

  const accessToken = await getAccessToken();

  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: "1"
  });

  const res = await fetch(
    `https://api.spotify.com/v1/search?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error("[Spotify] Search error:", data);
    throw new Error("Failed to search Spotify");
  }

  const items = data.tracks && data.tracks.items;
  if (!items || items.length === 0) {
    console.log("[Spotify] No tracks found for query:", query);
    return null;
  }

  const track = items[0];
  const result = {
    name: track.name,
    artists: (track.artists || []).map(a => a.name),
    uri: track.uri,
    url: track.external_urls && track.external_urls.spotify
  };

  console.log("[Spotify] searchTrack result:", result);
  return result;
}

/**
 * Add a track URI to the given playlist.
 */
async function addTrackToPlaylist(playlistId, trackUri) {
  if (!playlistId) {
    throw new Error("SPOTIFY_PLAYLIST_ID is not configured");
  }

  console.log("[Spotify] addTrackToPlaylist called with:", {
    playlistId,
    trackUri
  });

  const accessToken = await getAccessToken();

  // Debug: who am I and who owns this playlist
  await debugIdentity(accessToken, playlistId);

  const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      uris: [trackUri]
    })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("[Spotify] Add track error:", data);
    throw new Error("Failed to add track to Spotify playlist");
  }

  console.log("[Spotify] addTrackToPlaylist success:", data);
  return data;
}

module.exports = {
  searchTrack,
  addTrackToPlaylist
};


