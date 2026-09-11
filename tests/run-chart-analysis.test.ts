import test from "node:test";
import assert from "node:assert/strict";
import { executionLanes, statusCounts } from "../lib/run-chart-analysis";
test("execution lanes preserve sample indices and separate overlapping intervals", () => {
 const result = executionLanes([{ started_at:10, ended_at:30 }, { started_at:15, ended_at:20 }, { started_at:30, ended_at:40 }], null);
 assert.equal(result.lanes, 2); assert.equal(result.segments[0].lane, result.segments[2].lane);
 assert.notEqual(result.segments[0].lane, result.segments[1].lane);
 assert.deepEqual(result.segments.map((segment) => segment.index), [0,1,2]);
 assert.equal(result.elapsedMs, 30);
});
test("missing and malformed intervals are omitted, live time is explicit, simultaneous zero durations get distinct lanes", () => {
 const rows = [{ started_at:1, ended_at:null }, { started_at:3, ended_at:2 }, { started_at:NaN, ended_at:5 }];
 assert.equal(executionLanes(rows, null).omitted, 3);
 assert.equal(executionLanes(rows, 9).segments[0].durationMs, 8);
 assert.equal(executionLanes([{ started_at:1, ended_at:1 }, { started_at:1, ended_at:1 }], null).lanes, 2);
 assert.deepEqual(statusCounts([{status:"passed"},{status:"passed"},{status:"pending"}]), [{status:"passed",count:2},{status:"pending",count:1}]);
});
