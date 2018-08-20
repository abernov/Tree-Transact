var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/test', {
    useNewUrlParser: true
});

//var TreeSchema = require('treetransact')(
var TreeSchema = require('../lib/treetransact')(
  {
    name: { type: String } //name - addition field for parent document
  },{
    data: {} //data - addition field for child document
  } 
);
var Tree = mongoose.model('TreeTansactExample1', TreeSchema); //create model

async function test() { 
    await Tree.remove(); // remove all documents from TreeTansactExample1 collection

    // create document Folder1 
    var folder1 = new Tree({
      name: 'Folder1'
    });
    await folder1.save(); //save folder1 document to mongoDb

    // create document Folder2 
    var folder2 = new Tree({
      _id: new mongoose.Types.ObjectId,
      name: 'Folder2',
    });
    await folder2.save(); //save folder2 document to mongoDb

    // add child to Folder1
    var childIndex = 0; //Number in the array of children
    var childId = new mongoose.Types.ObjectId;
    folder1 = await Tree.addChild(folder1, childIndex, {
        _id: childId,
        data: 'File1'
    }); //update folder1 document in the mongoDb

    // move child from Folder1 to Folder2
    await Tree.moveChild(childId, folder1._id, folder2._id, childIndex);

    // get folder2 children
    folder2 = await Tree.findById(folder2._id);
    var children = await Tree.getChildren(folder2);
    console.log("children[0].data = " + children[0].data);

    // change child data for folder2
    folder2 = await Tree.updateChild(folder2, {
        _id: childId,
        data: {name: 'File_1'} 
    });

    // change folder2 name
    folder2 = await Tree.update(folder2, {
        name: 'Folder_2'
    });

   // add folder2 to children of  Folder1
    folder1 = await Tree.addChild(folder1, childIndex, {
        _id: folder2._id,
        data: 'Folder_2'
    });

    // remove child from folder2
    await Tree.removeChild(folder2, childId);

   // get folder2 children
   folder2 = await Tree.findById(folder2._id);
   children = await Tree.getChildren(folder2);
   console.log("After remove child, folder2 children length = " + children.length); // should be 0


    // safely remove folder2 and reference to it from folder1.
    var checkChildDoc =  true; //check that child document exists
    await Tree.removeChild(folder1, folder2._id, checkChildDoc);
    // here await Tree.getChildren(folder1).length return 1, child not removed yet!
    await Tree.remove({_id: folder2._id});

    // get folder1 children
    folder1 = await Tree.findById(folder1._id);
    children = await Tree.getChildren(folder1);
    console.log("After remove folder2, folder1 children length = " + children.length); // should be 0

    //safely add new folder3 to folder1 children
    var folder3 = new Tree({
            name: 'Folder3',
    });
    folder1 = await Tree.addChild(
        folder1,
        childIndex,
        {
          _id: folder3._id,
          data: 'Folder3'
        },
        checkChildDoc
    );
    // here await Tree.getChildren(folder1).length return 0, child not added yet!
    await folder3.save(); //save folder3 document to mongoDb

    folder1 = await Tree.findById(folder1._id);
    children = await Tree.getChildren(folder1);
    console.log("After add folder3, folder1 children length = " + children.length); // should be 1
}

Tree.setTimeout(60); //60 sec - default value
// The time for which the transaction should be guaranteed done.
// If the transaction is interrupted, then for this time the document is blocked for changes, 
// After this time the document will be restored.

var checkChildExistsCallback = async function (child) { //should return true if referenced document exists
    var doc = await Tree.findById(child._id).exec();
    return doc; 
}

Tree.setChildDocExistsCallback(checkChildExistsCallback);

test().then((r) => {console.log("Done")}).catch((err) => {
      console.log("error: " + err);
  });
