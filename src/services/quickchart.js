// Builds image URLs for QuickChart.io (https://quickchart.io) - a free
// service that renders a Chart.js config into a PNG and returns it directly
// as an image. We don't download/process anything ourselves; Discord just
// hotlinks the URL as the embed image, same as any other image URL.

function buildChartUrl(chartConfig, { width = 500, height = 300, backgroundColor = 'white' } = {}) {
  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encoded}&w=${width}&h=${height}&backgroundColor=${encodeURIComponent(backgroundColor)}`;
}

module.exports = { buildChartUrl };
