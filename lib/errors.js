'use strict';

var en = require('./locale/en');
module.exports = TreeError;

//see for example Assertion-Error

const TreeErrorCodes = {
  DocRemoveErr: 'Can\'t remove document',
  DocIsBuzy: 'Document is busy',
  NoChild: 'Child not exists'
}

/**
 * ### TreeError
 *
 * An extension of the JavaScript `Error` constructor for
 * assertion and validation scenarios.
 *
 * @param {Number} code
 * @param {Object} doctId (optional)
 * @param {Object} childId (optional)
 */


//https://learn.javascript.ru/oop-errors
function TreeError(code, docId, childId) {
  this.name = "TreeError";
  this.code = code;
  let msg = en.default.err[code];
  this.message = (msg)? msg : code;
  this.child = childId;
  this.doc = docId;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor); // (*)
  } else {
    this.stack = (new Error()).stack;
  }
}
TreeError.prototype = Object.create(Error.prototype);
TreeError.prototype.constructor = TreeError;



