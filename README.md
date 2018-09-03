tree-transact
=================
[![Build Status](https://api.travis-ci.org/abernov/Tree-Transact.svg?branch=master)](https://travis-ci.org/abernov/Tree-Transact?branch=master)
[![NPM version](https://badge.fury.io/js/tree-transact.svg)](http://badge.fury.io/js/tree-transact)
[![Dependency Status](https://david-dm.org/abernov/Tree-Transact/status.svg)](https://david-dm.org/abernov/Tree-Transact)
[![Coverage Status](https://coveralls.io/repos/github/abernov/Tree-Transact/badge.svg?branch=master)](https://coveralls.io/github/abernov/Tree-Transact?branch=master)
![vue version](https://img.shields.io/badge/vue-2.x-brightgreen.svg)
![MIT Licence](https://badges.frapsoft.com/os/mit/mit.svg?v=103)
<a href="https://npmcharts.com/compare/tree-transact?minimal=true">
  <img src="http://img.shields.io/npm/dm/tree-transact.svg">
</a>


A transaction system for tree documents for mongoose.

## Introduction

Tree document schema:
``` javascript
_id: ObjectId //this (parent) document id
children: // optional array of children
[
 {
     _id: ObjectId //this child document id or reference to document from another collections.
 },
 ...
]
```

Tree-transact allow:
- to safely move child documents from one parent document to another;
- to safely add and remove child documents;
- to safely change parent document data.

It is guaranteed that child documents will not multiply and will not disappear.
If a database or server error occurs, the documents are automatically restored.

It is possible to add additional fields to both the parent and child documents (name, data, collectionName, etc.).
Supported child documents from another collections.


## How to use tree-transact

### Install
```shell
npm install tree-transact -S
```

see the directory containing this source
/example/example1.js

### Run example
From within the directory containing this source:

>npm run example1

## Testing

From within the directory containing this source:
>npm run test

Warning: Continuous tests with random operations - take a few minutes

## Reserved fields in the child schema - do not use in your child schema
``` javascript
tran - transaction object
check - value for check child document exists.
```

## Fork it!
Pull requests, issues, and feedback are welcome.
