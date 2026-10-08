import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswer } from "./match.ts";

test("ไม่สนตัวพิมพ์และเครื่องหมาย", () => {
  assert.equal(checkAnswer("bohemian rhapsody", ["Bohemian Rhapsody - Remastered 2011"]), "correct");
  assert.equal(checkAnswer("DONT STOP ME NOW", ["Don't Stop Me Now"]), "correct");
});

test("ตัด feat. และวงเล็บ", () => {
  assert.equal(checkAnswer("stay", ["Stay (with Justin Bieber)"]), "correct");
  assert.equal(checkAnswer("peaches", ["Peaches feat. Daniel Caesar"]), "correct");
});

test("ยอมให้พิมพ์ผิดเล็กน้อย", () => {
  assert.equal(checkAnswer("bohemain rapsody", ["Bohemian Rhapsody"]), "correct");
  assert.equal(checkAnswer("yellwo", ["Yellow"]), "correct");
});

test("เพลงไทยและชื่อภาษาอังกฤษในวงเล็บ", () => {
  assert.equal(checkAnswer("ทางของฝุ่น", ["ทางของฝุ่น"]), "correct");
  assert.equal(checkAnswer("ทางของฝุน", ["ทางของฝุ่น"]), "correct");
  assert.equal(checkAnswer("dust", ["ทางของฝุ่น (Dust)"]), "correct");
});

test("เกือบถูก / ผิด", () => {
  assert.equal(checkAnswer("bohemian", ["Bohemian Rhapsody"]), "close");
  assert.equal(checkAnswer("hello", ["Bohemian Rhapsody"]), "wrong");
  assert.equal(checkAnswer("", ["Yellow"]), "wrong");
});

test("ชื่อไทย-อังกฤษคั่นด้วยขีด", () => {
  assert.equal(checkAnswer("ความจริง", ["ความจริง-Truth"]), "correct");
  assert.equal(checkAnswer("truth", ["ความจริง-Truth"]), "correct");
  assert.equal(checkAnswer("u prince", ["U-Prince"]), "correct");
  assert.equal(checkAnswer("มันเป็นใคร", ["มันเป็นใคร (Alright)"]), "correct");
});
