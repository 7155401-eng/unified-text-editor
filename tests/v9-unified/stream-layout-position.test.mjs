import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveV9TalmudStreamSlots,
  v9PhysicalSideForLayoutPosition,
} from "../../src/engine/v9_stream_position.js";

test("inner/outer follow physical page parity", () => {
  assert.equal(v9PhysicalSideForLayoutPosition("inner", 0), "right");
  assert.equal(v9PhysicalSideForLayoutPosition("outer", 0), "left");
  assert.equal(v9PhysicalSideForLayoutPosition("inner", 1), "left");
  assert.equal(v9PhysicalSideForLayoutPosition("outer", 1), "right");
});

test("legacy stream ordering remains unchanged without positioned roles", () => {
  assert.deepEqual(
    [...resolveV9TalmudStreamSlots({ streams:["01","02"], pageIndex:0 }).streams],
    ["01","02"]
  );
  assert.deepEqual(
    [...resolveV9TalmudStreamSlots({ streams:["01","02"], pageIndex:1, sideMode:"inner-outer" }).streams],
    ["02","01"]
  );
});

test("explicit onkelos left overrides global ordering", () => {
  const out = resolveV9TalmudStreamSlots({
    streams:["01","02"],
    pageIndex:0,
    sideMode:"inner-outer",
    streamSettings:{
      "01":{layoutRole:"onkelos",layoutPosition:"left"},
      "02":{layoutRole:"mishna",layoutPosition:"left"},
    },
  });
  assert.deepEqual([...out.streams], ["02","01"]);
  assert.deepEqual([...out.conflicts], []);
});

test("single positioned stream can occupy the real left slot", () => {
  const out = resolveV9TalmudStreamSlots({
    streams:["07"],
    pageIndex:0,
    streamSettings:{"07":{layoutRole:"side_notes",layoutPosition:"left"}},
  });
  assert.deepEqual([...out.streams], [null,"07"]);
});

test("inner and outer swap on even pages", () => {
  const settings={
    "01":{layoutRole:"onkelos",layoutPosition:"inner"},
    "02":{layoutRole:"side_notes",layoutPosition:"outer"},
  };
  assert.deepEqual(
    [...resolveV9TalmudStreamSlots({streams:["01","02"],streamSettings:settings,pageIndex:0}).streams],
    ["01","02"]
  );
  assert.deepEqual(
    [...resolveV9TalmudStreamSlots({streams:["01","02"],streamSettings:settings,pageIndex:1}).streams],
    ["02","01"]
  );
});

test("layoutPosition is ignored for roles that do not own it", () => {
  const out = resolveV9TalmudStreamSlots({
    streams:["01","02"],
    pageIndex:0,
    streamSettings:{
      "01":{layoutRole:"gemara",layoutPosition:"left"},
      "02":{layoutRole:"mishna",layoutPosition:"right"},
    },
  });
  assert.deepEqual([...out.streams], ["01","02"]);
});

test("same-side conflict never drops a stream", () => {
  const out = resolveV9TalmudStreamSlots({
    streams:["01","02"],
    pageIndex:0,
    streamSettings:{
      "01":{layoutRole:"onkelos",layoutPosition:"right"},
      "02":{layoutRole:"side_notes",layoutPosition:"right"},
    },
  });
  assert.deepEqual([...out.streams], ["01","02"]);
  assert.equal(out.conflicts.length,1);
  assert.deepEqual(out.conflicts[0],{
    side:"right",keptStream:"01",displacedStream:"02",
  });
});

test("streams after the two side slots keep their order", () => {
  const out = resolveV9TalmudStreamSlots({
    streams:["01","02","03","04"],
    pageIndex:1,
    streamSettings:{"01":{layoutRole:"onkelos",layoutPosition:"inner"}},
  });
  assert.deepEqual([...out.streams], ["02","01","03","04"]);
});
