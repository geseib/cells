// The site runs the SAME consistent-hash implementation as the deployed
// backend — not a copy, not an approximation. Everything shown in the
// simulations below is exactly what the routing Lambda would decide.
export { Cell, ConsistentHash, HashRing } from '../../../backend/lib/consistent-hash';
