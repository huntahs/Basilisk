// Fetches random Pokemon data from PokeAPI (free, official, no key needed)
// and generates a silhouette version of the official artwork for the
// "Who's That Pokemon?" guessing game.

const { Jimp, JimpMime } = require('jimp');

// National dex range to pick from - covers Gen 1 through Gen 9.
// Update the upper bound if/when new generations are added to PokeAPI.
const MIN_POKEMON_ID = 1;
const MAX_POKEMON_ID = 1025;

const SILHOUETTE_ALPHA_THRESHOLD = 10; // pixels less transparent than this get blackened

/**
 * Picks a random Pokemon and returns its name + official artwork URL.
 */
async function getRandomPokemon() {
  const id = Math.floor(Math.random() * (MAX_POKEMON_ID - MIN_POKEMON_ID + 1)) + MIN_POKEMON_ID;

  const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
  if (!response.ok) {
    throw new Error(`PokeAPI request failed for id ${id}: ${response.status}`);
  }

  const data = await response.json();
  const imageUrl = data.sprites?.other?.['official-artwork']?.front_default;

  if (!imageUrl) {
    throw new Error(`No official artwork found for Pokemon id ${id}`);
  }

  // Capitalize the name (PokeAPI returns lowercase, e.g. "pikachu")
  const name = data.name.charAt(0).toUpperCase() + data.name.slice(1);

  return { id, name, imageUrl };
}

/**
 * Downloads a Pokemon's artwork and returns a silhouette version as a PNG
 * buffer, ready to attach to a Discord message.
 */
async function generateSilhouetteBuffer(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download artwork: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();

  const image = await Jimp.read(Buffer.from(arrayBuffer));

  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
    const alpha = this.bitmap.data[idx + 3];
    if (alpha > SILHOUETTE_ALPHA_THRESHOLD) {
      this.bitmap.data[idx] = 0;     // R
      this.bitmap.data[idx + 1] = 0; // G
      this.bitmap.data[idx + 2] = 0; // B
      // alpha channel left untouched
    }
  });

  return image.getBuffer(JimpMime.png);
}

module.exports = { getRandomPokemon, generateSilhouetteBuffer };
