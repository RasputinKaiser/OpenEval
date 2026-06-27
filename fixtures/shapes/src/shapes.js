class Shape {
  constructor(name) { this.name = name; }
  area() { return 0; }
  toString() { return `${this.name} (area=${this.area()})`; }
}

class Circle extends Shape {
  constructor(radius) { super("circle"); this.radius = radius; }
  area() { return Math.PI * this.radius * this.radius; }
}

// TODO: add a Rectangle class with width and height, area = width * height

module.exports = { Shape, Circle };
