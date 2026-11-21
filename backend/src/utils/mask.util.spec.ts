import { maskName, maskPhone } from './mask.util';

describe('maskName', () => {
  it.each([
    ['Ravi Kumar', 'Ra** Ku***'],
    ['Imran Shaikh', 'Im*** Sh****'],
    ['Al', 'A*'],
    ['  Priya   Sharma ', 'Pr*** Sh****'],
  ])('masks "%s" as "%s"', (name, expected) => {
    expect(maskName(name)).toBe(expected);
  });
});

describe('maskPhone', () => {
  it.each([
    ['+919876543210', '+91******3210'],
    ['1234', '****'],
  ])('masks "%s" as "%s"', (phone, expected) => {
    expect(maskPhone(phone)).toBe(expected);
  });
});
