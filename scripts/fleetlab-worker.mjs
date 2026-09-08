/**
 * One shard of the composition tournament.
 *
 * Every battle is a pure function of its inputs and shares no state with any
 * other, so a shard's result is the same whatever else is running. The parent
 * sums the tallies; see `tournamentShard`.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { tournamentShard } from '../dist/fleetlab.js';

const { opts, index, count } = workerData;
parentPort.postMessage(tournamentShard(opts, index, count));
