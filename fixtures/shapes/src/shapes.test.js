const { test } = require("node:test");
const assert = require("node:assert");
const { Circle, Rectangle } = require("./shapes");

test("circle area", () => {
  const c = new Circle(2);
  assert.ok(Math.abs(c.area() - Math.PI * 4) < 1e-9);
});
test("rectangle area", () => {
  const r = new Rectangle(3, 4);
  assert.equal(r.area(), 12);
  assert.equal(r.name, "rectangle");
});
