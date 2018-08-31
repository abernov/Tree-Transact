'use strict';

/* The purpose of this schema is to allow you to modify 2 documents in
a collection, or roll back, creating a psuedo transaction system */

var mongoose          = require('mongoose');
var TreeError         = require('./errors');
var Schema            = mongoose.Schema;
var ObjectId          = mongoose.Schema.Types.ObjectId;

module.exports = function (treeSchemaDef, childSchemaDef) {

  const state_IDLE= undefined,
    state_TRANSMITTED= 1,
    state_RECEIVED= 2,
    state_REMOVE_CHILD= 3;

  const getNewCopy = {
    new: true, //return new version of doc 
    upsert: false //do not insert if it doesnt exist
  };

  var Tran = new Schema({
    state: {
      type: Number,
   },
    mate: {
      type: ObjectId
    },
    _id: {
      type: ObjectId
    }
  });

  if (!childSchemaDef) childSchemaDef = {};
  childSchemaDef._id = {
    type: ObjectId,
    required: true
  };
  childSchemaDef.check = {
      type: Number
  };
  childSchemaDef.tran = {
    type: Tran
  };
  var Child = new Schema(childSchemaDef);

  if (!treeSchemaDef) treeSchemaDef = {};
  treeSchemaDef.children = {
     type: [Child],
     default: undefined
  };
  var TreeTransact = new Schema(treeSchemaDef);

  TreeTransact.statics.getById = async function (id) {
    return this.findOne({ _id: id }).exec();
  }

  TreeTransact.statics.getByIdAndCheck = async function (docId) {
    var doc = await this.getById(docId);
    if (!doc) throw new TreeError('NoDoc', docId);
    return doc;
  }


  TreeTransact.methods.getChildIdx = function (childId) {
    var children = this.children;
    if (children) {
      for (var i = 0; i < children.length; i++) {
        if (children[i]._id.equals(childId)) {
          return i;
        }
      }
    }
    return -1;
  }

  function cmpIds(id1, id2) {
    if (id1) return id1.equals(id2);
    return (id1 === id2);
  }

  TreeTransact.statics.changeTransaction = async function (doc, childId, newState, tranId, newMate, newChildIdx, newChildValue) {
    var idx;
    var tran;
    var docId = doc._id;
    while (true) {
      idx = doc.getChildIdx(childId);
      if (idx < 0 ) {
        if (newState == state_RECEIVED) {
          if (!doc.children) doc.children = [];
          idx = newChildIdx;
          if (idx > doc.children.length) idx = doc.children.length;
          doc.children.splice(idx, 0, (newChildValue) ? newChildValue: {_id: childId} );
        } else {
          if (newState !== state_REMOVE_CHILD) throw new TreeError('NoChild', docId, childId);
          return doc;
        }
      } else {
        tran = doc.children[idx].tran;
        if (tran) {
          if (!cmpIds(tran._id, tranId)) throw new TreeError('InvTransId', docId, childId);
          if (tran.state === newState) return doc;
        }
        if (newState === state_RECEIVED && (!tran || tran.state !== state_RECEIVED)) throw new TreeError('ChildExists', docId, childId);
      }
      if (!newState) {
        doc.children[idx].tran = undefined;
      } else {
        if (newState === state_REMOVE_CHILD) {
          if (!tran) throw new TreeError('NoTrans', docId, childId);
          doc.children.splice(idx, 1);
        } else {
          if (tran) throw new TreeError('TransExists', docId, childId);
          doc.children[idx].tran = {
            _id: tranId,
            state: newState,
            mate: newMate
          };
        }
      }
      doc = await this.trySave(doc);
      if (doc) return doc;
      doc = await this.getByIdAndCheck(docId);
    };
  }


  TreeTransact.statics.repairChild = async function (doc, child) {
    var tran = child.tran;
    var docId = doc._id;
//  return this;
    try {
      if (tran.state === state_TRANSMITTED) {
// return this;
        let dst = await this.getById(tran.mate);
        let dstChIdx = (dst)? dst.getChildIdx(child._id) :-1;
        if (dstChIdx < 0) {
          let passtime = Date.now() - tran._id.getTimestamp();
          if (dst && passtime < this.timeout) return doc; //wait for Transaction done
          doc = await this.changeTransaction(doc, child._id, state_IDLE, tran._id);
        } else {
          doc = await this.changeTransaction(doc, child._id, state_REMOVE_CHILD, tran._id);
          await this.changeTransaction(dst, child._id, state_IDLE, tran._id);
        }
      } else {  //state_RECEIVED
        let src = await this.getById(tran.mate);
        if (src) await this.changeTransaction(src, child._id, state_REMOVE_CHILD, tran._id);
//return this;      
        doc = await this.changeTransaction(doc, child._id, state_IDLE, tran._id);
      }
    } catch (err) {
        doc = this.getByIdAndCheck(docId);
    }
    return doc;
  }

  TreeTransact.statics.getChildren = async function (doc) {
    var ch;
    var repaired = {};
    var checked = {};
    var res;
    var i;
    var children;
    var self = this;

    var restart = function() {
      i = 0;
      res = [];
      children = doc.children;
    }

    var checkChild = async function (ch, childIdx) {
      try {
        var r = await self.childDocExistsCallback(ch);
        checked[ch._id] = r;
        if ((Math.abs(ch.check) < Date.now()) || (ch.check > 0 && r) || (ch.check < 0 && !r ) ) {
          if (r) {
            doc.children[childIdx].check = undefined;
          } else {
            doc.children.splice(childIdx, 1);
          }
          doc = await self.trySave(doc);
          if (!doc) doc = await self.getByIdAndCheck(docId);
          restart();
        } else {
          if (r) res.push(ch);
        }
      } catch (error) {
        res.push(ch);
      }
    }

    var tryAddChild = function (ch) {
      if (!ch.check) {
        res.push(ch);
        return true;
      }
      var cval = checked[ch._id];
      if (cval)
        res.push(ch);
      return cval !== undefined;
    }

    restart();
    while (children && (i < children.length)) {
      ch = children[i++];
      if (ch.tran) {
        if (!repaired[ch._id]) {
          repaired[ch._id] = true;
          doc = await this.repairChild(doc, ch);
          restart();
        } else {
          if (ch.tran.state === state_TRANSMITTED) {
            if (!tryAddChild(ch)) await checkChild(ch, i - 1);
          }
        }
      } else 
          if (!tryAddChild(ch)) await checkChild(ch, i - 1);
    }
    return res;
  }

  TreeTransact.statics.trySave = async function (doc) {
    let ver = doc.__v
    doc.__v = ver + 1;
    return this.findOneAndUpdate({
        _id: doc._id,
        __v: ver,
      },
      doc,    
      getNewCopy
    ).exec();
  }


  TreeTransact.statics.addChild = async function (doc, index, childObject, checkChildDoc) {
    var docId = doc._id;
    var idx;
    if (!childObject._id) childObject._id = mongoose.Types.ObjectId();
    while (true) {
      idx = doc.getChildIdx(childObject._id);
      if (idx < 0) {
        if (!doc.children) throw new TreeError('NotFolder', doc._id);
        idx = (doc.children.length < index) ? doc.children.length : index;
        if (this.childDocExistsCallback && checkChildDoc) childObject.check = Date.now() + this.timeout;
        doc.children.splice(idx, 0, childObject);
        doc = await this.trySave(doc);
        if (doc) return doc;
        doc = await this.getByIdAndCheck(docId);
      } else {
        throw new TreeError('ChildExists', docId, childObject._id);
      }
    }
  }

  function throwChildNotExistsErr(docId, childId) {
    throw new TreeError('NoChild', docId, childId)
  } 

  TreeTransact.statics.removeChild = async function (doc, childId, checkChildDoc) {
    var docId = doc._id;
    var idx;
    while (true) {
      idx = doc.getChildIdx(childId);
      if (idx >= 0) {
        if (doc.children[idx].tran) {
          doc = await this.repairChild(doc, doc.children[idx]);
          idx = doc.getChildIdx(childId);
          if (idx < 0) throwChildNotExistsErr(docId, childId);
          if (doc.children[idx].tran) throw new TreeError('DocIsBuzy', docId);
        }
        if (this.childDocExistsCallback && checkChildDoc) {
          doc.children[idx].check = - (Date.now() + this.timeout);
        } else {
          doc.children.splice(idx, 1);
        }
        doc = await this.trySave(doc);
        if (doc) return doc;
        doc = await this.getByIdAndCheck(docId);
      } else {
        throwChildNotExistsErr(docId, childId);
      }
    }
  }

  TreeTransact.statics.removeFolderDoc = async function (docId) {
    var self = this;

    var delDoc = async function() {
      return self.findOneAndDelete({
        _id: docId,
        children: []
      }).exec();
    };

    var doc = await delDoc();
    if (!doc) {
      doc = await this.getById(docId);
      if (!doc) return;
      var children = await this.getChildren(doc);
      if (children.length === 0) {
        doc = await delDoc();
        if (doc) return;
      }
      throw new TreeError('DocRemoveErr', docId);
    }
  }

  TreeTransact.statics.update = async function (doc, newValue) {
    var docId = doc._id;
    while (true) {
      var __v = doc.__v;
      var children = doc.children;
      doc = newValue;
      doc._id = docId;
      doc.children = children;
      doc.__v = __v;
      doc = await this.trySave(doc);
      if (doc) return doc;
      doc = await this.getByIdAndCheck(docId);
    }
  }
  TreeTransact.statics.updateChild = async function (doc, newValue) {
    var docId = doc._id;
    var childId = newValue._id;
    var idx;
    while (true) {
      idx = doc.getChildIdx(childId);
      if (idx >= 0) {
        if (doc.children[idx].tran) {
          doc = await this.repairChild(doc, doc.children[idx]);
          idx = doc.getChildIdx(childId);
          if (idx < 0) throwChildNotExistsErr(docId, childId);
          if (doc.children[idx].tran) throw new TreeError('DocIsBuzy', docId);
        }
        doc.children[idx] = newValue;
        doc = await this.trySave(doc);
        if (doc) return doc;
        doc = await this.getByIdAndCheck(docId);
      } else {
        throwChildNotExistsErr(docId, childId);
      }
    }
  }

  TreeTransact.statics.getDocAndRepairChild = async function (docId, childId) {
    var doc = await this.getByIdAndCheck(docId);
    var idx = doc.getChildIdx(childId);
    if (idx < 0) throw new TreeError('NoChild', docId, childId);
    var ch = doc.children[idx];
    if (ch.tran) doc = await this.repairChild(doc, ch);
    return doc;
  }

  TreeTransact.statics.changeChildIndex = async function (doc, childId, newChildIdx) {
    var idx, newIdx;
    var child;
    var docId = doc._id;
    while (true) {
      idx = doc.getChildIdx(childId);
      if (idx < 0) throw new TreeError('NoChild', docId, childId);
      newIdx = newChildIdx;
      if (newIdx > doc.children.length-1) newIdx = doc.children.length-1;
      if (idx === newIdx) return doc;
      child = doc.children[idx];
      doc.children.splice(idx, 1);
      doc.children.splice(newIdx, 0, child);
      doc = await this.trySave(doc);
      if (doc) return doc;
      doc = await this.getByIdAndCheck(docId);
    }
  }

  TreeTransact.statics.timeout = 60000;

  TreeTransact.statics.setTimeout = function(valueSec) {
    this.timeout = valueSec *1000;
  }

  TreeTransact.statics.setChildDocExistsCallback = function (childDocExists) {
    if (childDocExists && typeof childDocExists !== 'function') throw new TreeError('Invalid childDocExists function');
    this.childDocExistsCallback = childDocExists;
  }

  TreeTransact.statics.moveChild = async function (childId, srcId, destId, destChildIdx) {
  try {
    if (childId.equals(destId)) throw new TreeError('MoveToSelf', srcId, childId);
    if (srcId.equals(destId)) {
      let src = await this.getDocAndRepairChild(srcId, childId);
      await this.changeChildIndex(src, childId, destChildIdx);
      return;
    }

    var [src, dst] = await Promise.all([
      this.getDocAndRepairChild(srcId, childId),
      this.getByIdAndCheck(destId)
    ]);
    var tranId = mongoose.Types.ObjectId();
    src = await this.changeTransaction(src, childId, state_TRANSMITTED, tranId, destId);
    var newChildValue = src.children[src.getChildIdx(childId)];
    try {
      dst = await this.changeTransaction(dst, childId, state_RECEIVED, tranId, srcId, destChildIdx, newChildValue);
    } catch (err) {
      src = await this.changeTransaction(src, childId, state_IDLE, tranId);
      throw err;
    }
    src = await this.changeTransaction(src, childId, state_REMOVE_CHILD, tranId);
    dst = await this.changeTransaction(dst, childId, state_IDLE, tranId);
  } catch (err) {
    throw err;
  }
  };

return TreeTransact;
};

