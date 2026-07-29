// Maps Strava's activity type strings to a $/mile rate.
// Values come from env vars so you can tune them without touching code.
// Strava's raw `type` field uses these exact strings for the common cases.
const RATES = {
  Run: parseFloat(process.env.RATE_RUN || '1.00'),
  TrailRun: parseFloat(process.env.RATE_RUN || '1.00'),
  Ride: parseFloat(process.env.RATE_BIKE || '0.30'),
  VirtualRide: parseFloat(process.env.RATE_BIKE || '0.30'),
  MountainBikeRide: parseFloat(process.env.RATE_BIKE || '0.30'),
  Swim: parseFloat(process.env.RATE_SWIM || '3.00'),
  Hike: parseFloat(process.env.RATE_HIKE || '1.00'),
  Walk: parseFloat(process.env.RATE_HIKE || '1.00'),
};

const DEFAULT_RATE = parseFloat(process.env.RATE_RUN || '1.00');

function rateFor(activityType) {
  return RATES[activityType] ?? DEFAULT_RATE;
}

module.exports = { RATES, rateFor };
