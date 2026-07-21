#!/usr/bin/env bash
set -euo pipefail
# Plausibly-wrong: adds a Rectangle that extends Shape (satisfies the
# structural file_contains grader) but computes area as width + height
# instead of width * height. tests_pass must reject it.
cat > src/shapes.js <<'JS'
class Shape {
  constructor(name) { this.name = name; }
  area() { return 0; }
  toString() { return `${this.name} (area=${this.area()})`; }
}
class Circle extends Shape {
  constructor(radius) { super("circle"); this.radius = radius; }
  area() { return Math.PI * this.radius * this.radius; }
}
class Rectangle extends Shape {
  constructor(width, height) { super("rectangle"); this.width = width; this.height = height; }
  area() { return this.width + this.height; }
}
module.exports = { Shape, Circle, Rectangle };
JS
