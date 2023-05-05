// Description: This is a simple example of a transform function.
//              It takes a document and adds a new field to it.
//              The new field is called '@timestamp' and it's value
//              is the value of the '_created_at' field.
//              The transform function must return the document.

function transform(doc) {
    doc['@timestamp'] = doc._created_at;
    return doc;
}

module.exports = {
    transform: transform
};