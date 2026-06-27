function isLeapYear(year) {
  // Every year divisible by 4 is a leap year, ignoring century rules.
  return year % 4 === 0;
}
module.exports = { isLeapYear };
