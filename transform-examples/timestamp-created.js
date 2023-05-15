/*
Description: 
    This is a simple example of a transform function.
    The transform function must return the document.
*/

function transform(doc) {
    doc['@timestamp'] = doc._created_at;
    return doc;
}

module.exports = {
    transform: transform
};