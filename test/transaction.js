'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var _ = require('lodash');
var async = require('async');

var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/test', { useNewUrlParser: true });

var TreeSchema = require('../index')(
  { name: { type: String }},
  { data: {},
    coll: { type: String}
  });
//var TreeSchema = require('../lib/treetransact')({ name: { type: String }}, { data: {}});
var Tree = mongoose.model('Tree', TreeSchema);
//Tree.setTimeout(60);

const state_IDLE = undefined,
  state_TRANSMITTED = 1,
  state_RECEIVED = 2,
  state_REMOVE_CHILD = 3;

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomArbitrary(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function getOrCreateId(ids, key) {
  var s = key.split(':');
  var akey = s[0];  
  var r = ids[akey];
  if (!r) {
    let passTime = (s.length>1)? parseInt(s[1])*1000: 0;
    r = mongoose.Types.ObjectId((Date.now() - passTime) / 1000);
//    r = mongoose.Types.ObjectId();
    ids[akey] = r;
  }
  return r;
}

function getKeyByValue(object, value) {
  let r = Object.keys(object).find(key => object[key].equals(value));
  if (r === "undefined") { r = value.toString(); }
  return r;
}


function transactionNameToId(src, ids) {
  return {
    _id: getOrCreateId(ids, src._id),
    state: src.state,
    mate: getOrCreateId(ids, src.mate)
  }
}

function treeCreateInt(src, ids, created, callback) {
  if (typeof ids === 'function') {
    callback = ids; //allow skipping of ids, created
    ids = new Object();
    getOrCreateId(ids, 'fake1');
    getOrCreateId(ids, 'fake2');
    getOrCreateId(ids, 'fake3');
    created = new Object();
  }

  //getOrCreateId(ids, src.name);

  var children = src.children;
  if (children === undefined) {
    children = [];
  }
  var ch = [];
  async.eachSeries(
      children,
      function (child, callback) {
        var lastId;
        treeCreateInt(child, ids, created, function (err) {
          if (!err) {
            let lastObj = new Object();
            lastObj._id = getOrCreateId(ids, child.name);
            if (child.tran) {
              lastObj.tran = transactionNameToId(child.tran, ids);
            }
            if (!child['children'] && child['coll'])
              lastObj['coll'] = child['coll'];
            if (child['data'])
              lastObj['data'] = child['data'];
            if (child['check'])
              lastObj['check'] = child['check'];
          ch.push(lastObj);
          }
          callback(err);
        });
      },
      function (err) {
        if (!err) {
          if (created[src.name]) {
            callback(err, ids);
          } else {
            var tt = new Tree({
              _id: getOrCreateId(ids, src.name),
              name: src.name,
            });
            if (src.children !== 0) {
              tt.children = ch;
            };
            tt.save(function (err) {
              if (!err) created[src.name] = true;
              callback(err, ids);
            });
          }
        } else {
          callback(err);
        }
      }
  );
}

function objToE(obj) {
  return (obj) ? 'exist' : 'not exist';
}

function cmpAndPrintIds(i, name1, id2, ids, childName, text) {
  let id1;
  if (name1) id1 = ids[name1];
  if ((id1 && id1.equals(id2)) || (!id1 && !id2)) return '';
  return ' Child №' + i + ', name: ' + childName + ', invalid ' + text + ': ' + getKeyByValue(ids, id2) + ', must be: ' + name1 + '\n';
}


function compareChildren(name, ids, src, db) {

  if (src === undefined && db.length !== 0) {
    return 'Object: ' + name + ' must not have children';
  }

  if (src === undefined) {return undefined;}

  if (src.length !== db.length) {
    return 'Object: ' + name + ' must have : ' + src.length + ' children, but it has: ' + db.length;
  }

  var r = '';
  src.forEach(function (item, i, arr) {
    if (!ids[item.name].equals(db[i]._id)) {
      r = r + ' Child №' + i + ', name: ' + getKeyByValue(ids, db[i]._id) + ', name must be: ' + item.name + '\n';
    };
    if (!(item.coll == db[i].coll || !item.coll === db[i].coll)) {
      r = r + ' Child №' + i + ', name: ' + getKeyByValue(ids, db[i]._id) + ', coll: ' + db[i].coll + ', coll must be: ' + item.coll + '\n';
    }

    if ((item.data || db[i].data) && JSON.stringify(item.data) !== JSON.stringify(db[i].data)) {
      r = r + ' Child №' + i + ', name: ' + getKeyByValue(ids, db[i]._id) + ', data: ' + JSON.stringify(db[i].data)
        +', data must be: ' + JSON.stringify(item.data) + '\n';
    }

    if ((item.data || db[i].data) && JSON.stringify(item.data) !== JSON.stringify(db[i].data)) {
      r = r + ' Child №' + i + ', name: ' + getKeyByValue(ids, db[i]._id) + ', data: ' + JSON.stringify(db[i].data)
        +', data must be: ' + JSON.stringify(item.data) + '\n';
    }

    if (item.check !== db[i].check) {
      r = r + ' Child №' + i + ', name: ' + getKeyByValue(ids, db[i]._id) + ', check: ' + db[i].check + ', check must be: ' + item.check + '\n';
    }

    let dbTran = db[i].tran;
    let itemTran = item.tran;

    if (!itemTran || !dbTran) {
      if (itemTran || dbTran) {
        r = r + ' Child №' + i + ', name: ' + item.name + ', transaction obj: ' + objToE(dbTran) + ', must be: ' + objToE(itemTran) + '\n';
      }
    } else {
      if (itemTran.state !== dbTran.state) {
        r = r + ' Child №' + i + ', name: ' + item.name + ', invalid state: ' + dbTran.state + ', must be: ' + itemTran.state + '\n';
      }
      r = r + cmpAndPrintIds(i, itemTran.mate, dbTran.mate, ids, item.name, 'mate');
      r = r + cmpAndPrintIds(i, itemTran._id, dbTran._id, ids, item.name, 'tran.id');
    }
  });
  if ( r !== '') {
    return 'Object: ' + name + '\n' + r;
  } else {
    return undefined;
  }
}

function treeCompareInt(src, ids, callback) {

  var children = src.children;
  if (children === undefined) {
    children = [];
  }
  async.eachSeries(
    children,
    function (child, callback) {
      var lastId;
      treeCompareInt(child, ids, callback);
    },
    function (err) {
      if (!err) {
        Tree.findOne(
          {
            _id: ids[src.name]
          },
          function (err, doc) {
            if (err) { throw err; }
            var errMsg;
            if (!doc) {
              errMsg = 'Document not found: ' + src.name;
            } else {
//              doc.checkChildren(docIdForMove, callback);  
              errMsg = compareChildren(src.name, ids, src.children, doc.children);
            }
            if (errMsg !== undefined) {
              callback(new Error(errMsg));
            } else
              callback();
          }
        );
      } else {
        callback(err);
      }
    }
  );
}

async function treeCompare(src, ids) {
  var promise = new Promise((resolve, reject) => {
    treeCompareInt(src, ids, function (err) {
            if (err) {
              reject (err);
            } else
              resolve ();
    });
  });
  return promise;
}


function compareChildrenList(sample, children, ids) {
  var r = '';
  if (sample.length !== children.length) {
      r = r + 'Children length: ' + children.length + ', must be: ' + sample.length + '\n';
  }
  var len = (sample.length < children.length) ? sample.length: children.length;
  for (let i = 0; i < len; i++) {
    if ( !ids[sample[i].name].equals(children[i]._id) )
      r = r + ' Child №' + i + ', name: ' + sample[i].name + ', must be: ' + getKeyByValue(ids, children[i]._id) + '\n';
  }
  if (r) throw new Error('Error: children check \n'+r);
}

async function treeCreate(src) {
  var promise = new Promise((resolve, reject) => {
    treeCreateInt(src, function (err, ids) {
      if (err) {
        reject(err);
      } else
        resolve(ids);
    });
  });
  return promise;
}


function remId(all, id, ids){
    for (let i = 0; i < all.length; i++) {
      if (all[i].equals(id)) {
        all.splice(i, 1);
        return '';
      }
    }
    return 'Doc is duplicated: ' + getKeyByValue(ids, id) + '\n';
};


async function checkContinuousTestResult(folders, files, ids, __v, tag) {
  var all = folders.concat(files);
  all.splice(0, 1);

  var result;
  var t = '';
  for (let i = 0; i < folders.length; i++) {
    let srcDoc = await Tree.getById(folders[i]);
    if (i === 0 ) {
      if ( srcDoc.__v === __v) 
          throw new Error('Error: Process froze');
      result = srcDoc.__v;
    }

    let children = await Tree.getChildren(srcDoc, tag);
    for (var j = 0; j < children.length; j++) {
       t = t + remId(all, children[j]._id, ids);
    }
  }

  for (let i = 0; i < all.length; i++) {
     t = t + 'Doc is lost: ' + getKeyByValue(ids, all[i]) + '\n';
  }
  if (t)
    throw new Error('Error: \n' + t);
  return result;
}

async function continuousMoveChildTest(folders, files, durationSec, moveToSelf, log, tag) {
  if (log) console.log('continuousMoveChildTest is started!');
  let stopTime = Date.now() + durationSec * 1000;
  var rnd1, rnd2;
  while (Date.now() < stopTime) {    
    try {
      rnd1 = getRandomArbitrary(0, folders.length);
      do {
        rnd2 = getRandomArbitrary(0, folders.length);
      }
      while (!moveToSelf && rnd1 === rnd2);
      let srcFolderId = folders[rnd1];
      let dstFolderId = folders[rnd2];

      let srcDoc = await Tree.getById(srcFolderId);
      let children = await Tree.getChildren(srcDoc, tag);
      if (children.length) {
        let childId = children[getRandomArbitrary(0, children.length)]._id;
        let dstChildIdx = getRandomArbitrary(0, files.length);
        if (!childId.equals(dstFolderId)) {
            await Tree.moveChild(childId, srcFolderId, dstFolderId, dstChildIdx);
        }
      }
    } catch (err) {
      if (log) console.log(err);
    }
  }
  if (log) console.log('continuousMoveChildTest is finished!');
  return true;
}


describe('Tree-Transact tests', function(){

  describe('changeTransaction function', function () {

    var tag = undefined;

    beforeEach(function(done){
      Tree.deleteMany({}, done);
    });

    it('should not give an error on properly constructed tree', async function () {
      let tree_idle = {
        name: 'root',
        children: [{
          name: 'folder1',
          children: [
            {name: 'file1', coll: 'flowers', data: 'aName', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'root'}}
          ]
        }]
      };
      let ids = await treeCreate(tree_idle);
      await treeCompare(tree_idle, ids);
    });

    it('should not give an error on changeTransaction from IDLE to IDLE', async function () {
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1'}
        ]
      };
      let ids = await treeCreate(treeDest);
      let root = await Tree.getById(ids.root);
      let newDoc = await Tree.changeTransaction(root, ids.file1, state_IDLE);
      should.exist(newDoc);
      await treeCompare(treeDest, ids);
      //    expect(p).to.equal(4);
    });

    it('should not give an error on changeTransaction from IDLE to TRANSMITTED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1' },
          { name: 'folder1', children: [] }
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let folder1 = await Tree.getById(ids.root);
      let newDoc = await Tree.changeTransaction(folder1, ids.file1, state_TRANSMITTED, ids.tran1, ids.folder1);
      should.exist(newDoc);
      await treeCompare(treeDest, ids);
    });

    it('should not give an error on changeTransaction from TRANSMITTED to IDLE', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'root'}}
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1'}
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      root.__v = 1;
      let newDoc = await Tree.changeTransaction(root, ids.file1, state_IDLE, ids.tran1);
      should.exist(newDoc);
      await treeCompare(treeDest, ids);
      //    expect(p).to.equal(4);
    });

    it('should not give an error on changeTransaction from TRANSMITTED to TRANSMITTED', async function () {
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeDest);
      let root = await Tree.getById(ids.root);
      let newDoc = await Tree.changeTransaction(root, ids.file1, state_TRANSMITTED, ids.tran1, ids.folder1);
      should.exist(newDoc);
      await treeCompare(treeDest, ids);
    });


    it('should not give an error on changeTransaction from XXX to RECEIVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [
            { name: 'file1', data:'hello', tran:{_id:'tran1', state: state_RECEIVED, mate: 'root'}},
          ]}
        ]
      };
      let ids = await treeCreate(treeSrc);
      let folder1 = await Tree.getById(ids.folder1);
      folder1 = Tree.changeTransaction(folder1, ids.file1, state_RECEIVED, ids.tran1, ids.root, 5, { _id: ids.file1, data:'hello'} );
      should.exist(folder1);
      await treeCompare(treeDest, ids);
    });


    it('should not give an error on changeTransaction from RECEIVED to RECEIVED', async function () {
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [
            { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'root'}},
          ]}
        ]
      };
      let ids = await treeCreate(treeDest);
      let folder1 = await Tree.getById(ids.folder1);
      folder1 = await Tree.changeTransaction(folder1, ids.file1, state_RECEIVED, ids.tran1, ids.root, 5);
      should.exist(folder1);
      await treeCompare(treeDest, ids);
    });

    it('should not give an error on changeTransaction from TRANSMITTED to CHILD_REMOVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      root = await Tree.changeTransaction(root, ids.file1, state_REMOVE_CHILD, ids.tran1);
      should.exist(root);
      await treeCompare(treeDest, ids);
    });

    it('should not give an error on changeTransaction from TRANSMITTED(one child) to CHILD_REMOVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'folder1', children: [
            { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'root'}},
          ] }
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let folder1 = await Tree.getById(ids.folder1);
      folder1 = await Tree.changeTransaction(folder1, ids.file1, state_REMOVE_CHILD, ids.tran1);
      should.exist(folder1);
      await treeCompare(treeDest, ids);
    });

    it('should not give an error on changeTransaction from CHILD_REMOVED to CHILD_REMOVED', async function () {
      let treeDest = {
        name: 'root',
        children: [
          { name: 'folder1', children: [
            { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'root'}},
          ]}
        ]
      };
      let ids = await treeCreate(treeDest);
      let root = await Tree.getById(ids.root);
      root = await Tree.changeTransaction(root, ids.file1, state_REMOVE_CHILD, ids.tran1);
      should.exist(root);
      await treeCompare(treeDest, ids);
    });

    it('should not give an error on changeTransaction from XXX to RECEIVED; from TRANSMITTED to CHILD_REMOVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'folder1', children: [
            { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'root'}},
          ]}
        ]
      };
      let ids = await treeCreate(treeSrc);
      let folder1 = await Tree.getById(ids.folder1);
      folder1 = await Tree.changeTransaction(folder1, ids.file1, state_RECEIVED, ids.tran1, ids.root, 0);
      should.exist(folder1);

      let root = await Tree.getById(ids.root);
      root = await Tree.changeTransaction(root, ids.file1, state_REMOVE_CHILD, ids.tran1);
      should.exist(root);
//    should.not.exist(err);
      await treeCompare(treeDest, ids);
    });





    it('should give error "invalid transaction _id" on changeTransaction(fakeId) from TRANSMITTED to TRANSMITTED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let err;
      try {
        await Tree.changeTransaction(root, ids.file1, state_TRANSMITTED, ids.fake1, ids.root);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });

    it('should give error "invalid transaction _id" on changeTransaction(fakeId) from RECEIVED to RECEIVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let err;
      try {
        await Tree.changeTransaction(root, ids.file1, state_RECEIVED, ids.fake1, ids.folder1, 0);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });

    it('should give error "invalid transaction _id" on changeTransaction(fakeId) from RECEIVED to CHILD_REMOVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let err;
      try {
        await Tree.changeTransaction(root, ids.file1, state_REMOVE_CHILD, ids.fake1);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });

    it('should give error "invalid transaction _id" on changeTransaction(fakeId) from RECEIVED to IDLE', async function () {
      let treeSrc = {
        name: 'root',
        children: [{
            name: 'file1',
            tran: {
              _id: 'tran1',
              state: state_RECEIVED,
              mate: 'folder1'
            }
          },
          {
            name: 'folder1',
            children: []
          }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let err;
      try {
        await Tree.changeTransaction(root, ids.file1, state_IDLE, ids.fake1);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });

    it('should give error on changeTransaction from TRANSMITTED to RECEIVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let err;
      try {
        await Tree.changeTransaction(root, ids.file1, state_RECEIVED, ids.tran1, ids.forder1, 1);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });

    it('should give error on changeTransaction from IDLE(child exists) to RECEIVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1' },
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let err;
      try {
        await Tree.changeTransaction(root, ids.file1, state_RECEIVED, ids.tran1, ids.forder1, 0);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });

    it('should give error on changeTransaction from IDLE to CHILD_REMOVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1' },
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let err;
      try {
        await Tree.changeTransaction(root, ids.file1, state_REMOVE_CHILD);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });


    it('should give error on changeTransaction from RECEIVED to TRANSMITTED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let err;
      try {
        await Tree.changeTransaction(root, ids.file1, state_TRANSMITTED, ids.tran1, ids.forder1);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });

    it('should give error on changeTransaction from CHILD_REMOVED to TRANSMITTED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let folder1 = await Tree.getById(ids.folder1);
      let err;
      try {
        await Tree.changeTransaction(folder1, ids.file1, state_TRANSMITTED, ids.tran1, ids.root);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });

    it('should give error on changeTransaction from CHILD_REMOVED to IDLE', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let folder1 = await Tree.getById(ids.folder1);
      let err;
      try {
        await Tree.changeTransaction(folder1, ids.file1, state_IDLE, ids.tran1, ids.root);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });






  });

describe('getChildren function, should not give an error', function () {

  beforeEach(function (done) {
    Tree.deleteMany({}, done);
  });

  afterEach(function (done) {
    Tree.setChildDocExistsCallback(undefined);
    done();
  });


    it('this=TRANSMITTED / mate=RECEIVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [
            { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'root'}}
          ] }
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'folder1', children: [
            { name: 'file1'},
          ]}
        ]
      };
      let childrenOut = [
        {name:'folder1'}
      ];
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let children = await Tree.getChildren(root);
      should.exist(children);
      compareChildrenList(childrenOut, children, ids);
      await treeCompare(treeDest, ids);
    });


    it('this=TRANSMITTED / mate=IDLE', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: [
            { name: 'file1'},
          ]}
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'folder1', children: [
            { name: 'file1'},
          ]}
        ]
      };
      let childrenOut = [
        {name:'folder1'}
      ];
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let children = await Tree.getChildren(root);
      should.exist(children);
      compareChildrenList(childrenOut, children, ids);
      await treeCompare(treeDest, ids);
    });

    it('this=TRANSMITTED / mate=CHILD_REMOVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: []}
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: []}
        ]
      };
      let childrenOut = [
        {name:'file1'},
        {name:'folder1'}
      ];
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let children = await Tree.getChildren(root);
      should.exist(children);
      compareChildrenList(childrenOut, children, ids);
      await treeCompare(treeDest, ids);
    });


    it('this=TRANSMITTED / mate=CHILD_REMOVED, after create transaction pass 120sec', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1:120', state: state_TRANSMITTED, mate: 'folder1'}},
          { name: 'folder1', children: []}
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1'},
          { name: 'folder1', children: []}
        ]
      };
      let childrenOut = [
        {name:'file1'},
        {name:'folder1'}
      ];
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let children = await Tree.getChildren(root);
      should.exist(children);
      compareChildrenList(childrenOut, children, ids);
      await treeCompare(treeDest, ids);
    });

    it('this=TRANSMITTED / mate=invalid', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'folder2'}},
          { name: 'folder1', children: []}
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1'},
          { name: 'folder1', children: []}
        ]
      };
      let childrenOut = [
        {name:'file1'},
        {name:'folder1'}
      ];
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let children = await Tree.getChildren(root);
      should.exist(children);
      compareChildrenList(childrenOut, children, ids);
      await treeCompare(treeDest, ids);
    });

    it('this=RECEIVED / mate=TRANSMITTED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'folder1'}},
          { name: 'folder1', children: [
            { name: 'file1', tran:{_id:'tran1', state: state_TRANSMITTED, mate: 'root'}}
          ] }
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1'},
          { name: 'folder1', children: []}
        ]
      };
      let childrenOut = [
        {name:'file1'},
        {name:'folder1'}
      ];
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let children = await Tree.getChildren(root);
      should.exist(children);
      compareChildrenList(childrenOut, children, ids);
      await treeCompare(treeDest, ids);
    });

    it('this=RECEIVED / mate=CHILD_REMOVED', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'folder1'}},
          { name: 'folder1', children: [] }
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1'},
          { name: 'folder1', children: []}
        ]
      };
      let childrenOut = [
        {name:'file1'},
        {name:'folder1'}
      ];

      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let children = await Tree.getChildren(root);
      should.exist(children);
      compareChildrenList(childrenOut, children, ids);
      await treeCompare(treeDest, ids);
    });

    it('this=RECEIVED / mate=invalid', async function () {
      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', tran:{_id:'tran1', state: state_RECEIVED, mate: 'folder2'}},
          { name: 'folder1', children: [] }
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1'},
          { name: 'folder1', children: []}
        ]
      };
      let childrenOut = [
        {name:'file1'},
        {name:'folder1'}
      ];

      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let children = await Tree.getChildren(root);
      should.exist(children);
      compareChildrenList(childrenOut, children, ids);
      await treeCompare(treeDest, ids);
    });


    it('this=IDLE setChildDocExistsCallback', async function () {
      let checkDN = Date.now()-1;
      let checkDP = checkDN + 120000;
      let checkDM = - checkDP;


      let treeSrc = {
        name: 'root',
        children: [
          { name: 'file1', check: checkDP },
          { name: 'file2', check: checkDP },
          { name: 'file3', check: checkDN},
          { name: 'file4', check: checkDN},
          { name: 'file5', check: checkDP, tran:{_id:'tran1', state: state_RECEIVED, mate: 'folder2'}},
          { name: 'file6', check: checkDP, tran:{_id:'tran2', state: state_RECEIVED, mate: 'folder2'}},
          { name: 'file7', check: checkDN, tran:{_id:'tran3', state: state_RECEIVED, mate: 'folder2'}},
          { name: 'file8', check: checkDN, tran:{_id:'tran4', state: state_RECEIVED, mate: 'folder2'}},
        ]
      };
      let treeDest = {
        name: 'root',
        children: [
          { name: 'file1' },
          { name: 'file2', check: checkDP },
          { name: 'file3' },
          { name: 'file5' },
          { name: 'file6', check: checkDP },
          { name: 'file7' },
        ]
      };
      let childrenOut = [
        {name:'file1'},
        {name:'file3'},
        {name:'file5'},
        {name:'file7'},
      ];
      
      let ids = await treeCreate(treeSrc);

      let cb = async function (child) {
        if (child._id.equals(ids.file1))
          return true;
        if (child._id.equals(ids.file2))
          return false;
        if (child._id.equals(ids.file3))
          return true;
        if (child._id.equals(ids.file4))
          return false;
        if (child._id.equals(ids.file5))
          return true;
        if (child._id.equals(ids.file6))
          return false;
        if (child._id.equals(ids.file7))
          return true;
        if (child._id.equals(ids.file8))
          return false;
        }

      Tree.setChildDocExistsCallback(cb);

      let root = await Tree.getById(ids.root);
      let children = await Tree.getChildren(root);
      should.exist(children);
      compareChildrenList(childrenOut, children, ids);
      await treeCompare(treeDest, ids);
    });


});


describe('moveChild, addChild, removeChild functions', function () {

    var tag = undefined;

   //   this.timeout(4000)
    beforeEach(function (done) {
      Tree.deleteMany({}, done);
    });

    it('should not give an error on moveChild FILE1 from FOLDER1 to ROOT', async function () {
      let treeSrc = {
        name: 'root',       
        children: [
          { name: 'folder1', children: [
            {name: 'file1', coll: "test", data: 'File1' }
          ]}
        ]
      };
      let treeDest = {
        name: 'root',       
        children: [
          { name: 'folder1', children: []},
          { name: 'file1', coll: "test", data: 'File1' }
        ]
      };
      let ids = await treeCreate(treeSrc);
      await Tree.moveChild(ids.file1, ids.folder1, ids.root, 1);
      await treeCompare(treeDest, ids);
//    expect(p).to.equal(4);
    });

    it('should not give an error on moveChild FILE1 from ROOT to ROOT', async function () {
      let treeSrc = {
        name: 'root',       
        children: [
          {name: 'file1', coll: "test", data: 'File1' },
          { name: 'folder1', children: []}
        ]
      };
      let treeDest = {
        name: 'root',       
        children: [
          { name: 'folder1', children: []},
          { name: 'file1', coll: "test", data: 'File1' }
        ]
      };
      let ids = await treeCreate(treeSrc);
      await Tree.moveChild(ids.file1, ids.root, ids.root, 1);
      await treeCompare(treeDest, ids);
//    expect(p).to.equal(4);
    });
    
    it('should not give an error on addChild FILE2 to ROOT', async function () {
      let treeSrc = {
        name: 'root',       
        children: [
          {name: 'file1', coll: "test", data: 'File1' },
          { name: 'folder1', children: [ {name: 'file2'} ]}
        ]
      };
      let treeDest = {
        name: 'root',       
        children: [
          { name: 'file1', coll: "test", data: 'File1' },
          { name: 'file2', coll: "test2", data: 'File2' },
          { name: 'folder1', children: [ {name: 'file2'} ]}
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      root.__v = 1;
      await Tree.addChild(root, 1, { _id: ids.file2, data: 'File2', coll: 'test2' });
      await treeCompare(treeDest, ids);
//    expect(p).to.equal(4);
    });
    
    it('should not give an error on removeChild FILE1 from ROOT, child has active transaction', async function () {
      let treeSrc = {
        name: 'root',       
        children: [
          { name: 'folder1', children: []},
          { name: 'file1', coll: "test", data: 'File1', tran: {_id:'tran1', state: state_RECEIVED, mate: 'folder1'} }
        ]
      };
      let treeDest = {
        name: 'root',       
        children: [
          { name: 'folder1', children: []}
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      await Tree.removeChild(root, ids.file1);
      await treeCompare(treeDest, ids);
//    expect(p).to.equal(4);
    });

    it('should not give an error on removeChild FILE1 from ROOT', async function () {
      let treeSrc = {
        name: 'root',       
        children: [
          { name: 'folder1', children: []},
          { name: 'file1', coll: "test", data: 'File1' }
        ]
      };
      let treeDest = {
        name: 'root',       
        children: [
          { name: 'folder1', children: []}
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      root.__v = 1;
      await Tree.removeChild(root, ids.file1);
      await treeCompare(treeDest, ids);
//    expect(p).to.equal(4);
    });

    it('should give error "Document not exists" on moveChild FILE1 from invalid to ROOT', async function () {
      let treeSrc = {
        name: 'root',       
        children: [
          { name: 'folder1', children: [
            {name: 'file1'}
          ]}
        ]
      };
      let ids = await treeCreate(treeSrc);
      let err;
      try {
        await Tree.moveChild(tag, ids.file1, ids.fake1, ids.root, 1);
     } catch (e) {
        err = true;
      }
      should.exist(err);
    });

    it('should give error "Document not exists" on moveChild FILE1 from FOLDER1 to invalid', async function () {
      let treeSrc = {
        name: 'root',       
        children: [
          { name: 'folder1', children: [
            {name: 'file1'}
          ]}
        ]
      };
      let ids = await treeCreate(treeSrc);
      let err;
      try {
        await Tree.moveChild(tag, ids.file1, ids.folder1, ids.fake1, 1);
     } catch (e) {
        err = true;
      }
      should.exist(err);
    });


    it('should give error "Cant be moved to itself" on moveChild FOLDER1 from ROOT to FOLDER1', async function () {
      let treeSrc = {
        name: 'root',       
        children: [
          { name: 'folder1', children: []}
        ]
      };
      let ids = await treeCreate(treeSrc);
      let err;
      try {
        await Tree.moveChild(tag, ids.folder1, ids.root, ids.folder1, 1);
     } catch (e) {
        err = true;
      }
      should.exist(err);
    });


    it('should give error on removeChild FILE1 from ROOT, child has active transaction', async function () {
      let treeSrc = {
        name: 'root',       
        children: [
          { name: 'folder1', children: []},
          { name: 'file1', coll: "test", data: 'File1', tran: {_id:'tran1', state: state_TRANSMITTED, mate: 'folder1'} }
        ]
      };
      let ids = await treeCreate(treeSrc);
      let root = await Tree.getById(ids.root);
      let err;
      try {
        await Tree.removeChild(root, ids.file1);
      } catch (e) {
        err = true;
      }
      should.exist(err);
    });


});

  describe('Continuous tests with random operations - take a few minutes!', function () {

  var sandbox;
  var errorsPercent = 0;
//  var stub1;

  before(function (done) {
//    stub1 = sinon.stub(Transaction.prototype, "getById").callsFake(function(callback) {callback()});

    sandbox = sinon.createSandbox();
    sandbox.replace(Tree, 'getById', async function (id) {
      await timeout(getRandomArbitrary(0, 20));
      if (errorsPercent && getRandomArbitrary(0, 100) < errorsPercent ) {
        throw new Error('Error: DB - emulated');        
      }
      return this.findOne({_id: id }).exec();
    });
    done();
  });

  after(function (done) {
    sandbox.restore();
//   stub1.restore();
    done();
  });

  beforeEach(function (done) {
    errorsPercent = 0;
    Tree.setTimeout(60); //Seconds
    Tree.deleteMany({}, done);
  });


    it('should not give an error on moveChild, files:4, folders:2, processes: 1', async function () {
      this.timeout(0); //disable timeout
      let treeDest = {
        name: 'root',       
        children: [
          { name: 'file1' },
          { name: 'file2' },
          { name: 'file3' },
          { name: 'file4' },
          { name: 'folder1', children: [] },
          { name: 'folder2', children: [] }
        ]
      };
      let ids = await treeCreate(treeDest);
      let folders = [
        ids.root, //must be first
        ids.folder1,
        ids.folder2
      ];
      let files = [
        ids.file1,
        ids.file2,
        ids.file3,
        ids.file4
      ];

      await continuousMoveChildTest(folders, files, 5);
      await checkContinuousTestResult(folders, files, ids);
//    expect(p).to.equal(4);
    });

    it('should not give an error on moveChild, files:1, folders:2, processes: 3', async function () {
      this.timeout(0); //disable timeout
      let treeDest = {
        name: 'root',       
        children: [
          { name: 'file1' },
          { name: 'folder1', children: [] }
        ]
      };
      let ids = await treeCreate(treeDest);
      let folders = [
        ids.root, //must be first
        ids.folder1
      ];
      let files = [
        ids.file1,
      ];

      let showLog = false;
      let moveToSelf = false;
      let testDuration = 1; //seconds
      let __v = 0;
      let testRepeat = 2;
      for (var i = 0; i < testRepeat; i++) {
        await Promise.all([
          continuousMoveChildTest(folders, files, testDuration, moveToSelf, showLog),
          continuousMoveChildTest(folders, files, testDuration, moveToSelf, showLog),
          continuousMoveChildTest(folders, files, testDuration, moveToSelf, showLog),
        ]);
        __v = await checkContinuousTestResult(folders, files, ids, __v);
      };
//    expect(p).to.equal(4);
    });


    it('should not give an error on moveChild, files:4, folders:3, processes: 3', async function () {
      this.timeout(0); //disable timeout
      let treeDest = {
        name: 'root',       
        children: [
          { name: 'file1', coll: "test", data: 'File1' },
          { name: 'file2', coll: "test", data: 'File2' },
          { name: 'file3', coll: "test", data: 'File3' },
          { name: 'file4', coll: "test", data: 'File4' },
          { name: 'folder1', children: [] },
          { name: 'folder2', children: [] }
        ]
      };
      let ids = await treeCreate(treeDest);
      let folders = [
        ids.root, //must be first
        ids.folder1,
        ids.folder2
      ];
      let files = [
        ids.file1,
        ids.file2,
        ids.file3,
        ids.file4
      ];

      let showLog = false;
      let moveToSelf = false;
      let testDuration = 5; //seconds
      let __v = 0;
      let testRepeat = 2;
      for (var i = 0; i < testRepeat; i++) {
        await Promise.all([
          continuousMoveChildTest(folders, files, testDuration, moveToSelf, showLog),
          continuousMoveChildTest(folders, files, testDuration, moveToSelf, showLog),
          continuousMoveChildTest(folders, files, testDuration, moveToSelf, showLog),
        ]);
//        __v = await checkContinuousTestResult(folders, files, ids, __v, 'check');
        __v = await checkContinuousTestResult(folders, files, ids, __v);
      };
//    expect(p).to.equal(4);
    });


    it('should not give an error on moveChild, files:4, folders:3, processes: 3, errors: 30%, moveToSelf', async function () {
      this.timeout(0); //disable timeout
      let treeDest = {
        name: 'root',       
        children: [
          { name: 'file1', coll: "test", data: 'File1' },
          { name: 'file2', coll: "test", data: 'File2' },
          { name: 'file3', coll: "test", data: 'File3' },
          { name: 'file4', coll: "test", data: 'File4' },
          { name: 'folder1', children: [] },
          { name: 'folder2', children: [] }
        ]
      };
      let ids = await treeCreate(treeDest);
      let folders = [
        ids.root, //must be first
        ids.folder1,
        ids.folder2
      ];
      let files = [
        ids.file1,
        ids.file2,
        ids.file3,
        ids.file4
      ];

      Tree.setTimeout(2); //Seconds
      let showLog = false;
      let moveToSelf = true;
      let testDuration = 10; //seconds
      let __v = 0;
      let testRepeat = 2;
      for (var i = 0; i < testRepeat; i++) {
        errorsPercent = 30;
        await Promise.all([
//          continuousMoveChildTest(folders, files, testDuration, showLog, '0'),
//          continuousMoveChildTest(folders, files, testDuration, showLog, '1'),
//          continuousMoveChildTest(folders, files, testDuration, showLog, '2'),
          continuousMoveChildTest(folders, files, testDuration, moveToSelf, showLog),
          continuousMoveChildTest(folders, files, testDuration, moveToSelf, showLog),
          continuousMoveChildTest(folders, files, testDuration, moveToSelf, showLog),
        ]);
//        __v = await checkContinuousTestResult(folders, files, ids, __v, 'check');
      
        errorsPercent = 0;
        await timeout(2*1000 + 200);
        __v = await checkContinuousTestResult(folders, files, ids, __v);
      };
//    expect(p).to.equal(4);
    });

  });
  
});