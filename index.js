// node index.js --m_host mongodb://localhost:27017 --m_db profilesraw --m_collection linkedinraw --e_host 35.202.115.2:9200 --e_index test --e_type profile

//node index.js --m_host mongodb://localhost:27017 --m_db profilesraw --m_collection linkedinraw --e_host 35.202.115.2:9200 --e_index test --e_type profile --m_limit 1

'use strict';

const MongoClient = require('mongodb').MongoClient;
const elasticsearch = require('elasticsearch');
const commandLineArgs = require('command-line-args');
const {ObjectId} = require('mongodb');
const options = commandLineArgs([
    {name: 'm_host', type: String},
    {name: 'm_db', type: String},
    {name: 'm_collection', type: String},
    {name: 'm_limit', type: Number},
    {name: 'm_fields', type: String},
    {name: 'm_skip_id', type: String},
    {name: 'e_host', type: String},
    {name: 'e_index', type: String},
    {name: 'e_type', type: String}

]);


function transformDoc(doc) {
    if (options.m_fields) {
        let returnDoc = {};
        options.m_fields.forEach((key) => {
            returnDoc[key] = doc[key];
        });
        return returnDoc;

    }
    else {
        delete doc.sync;
        delete doc.processing;
        delete doc._id;
        return doc;
    }

}

class MongoAPI {
    constructor(db, collection,mongoSkipId) {
        this.db = db;
        this.collection = collection;
        this.mongoSkipId = mongoSkipId;
    }

    get_docs(callback) {
        let query = {};
        if (this.mongoSkipId) {
            query["_id"] = {$gt: ObjectId(this.mongoSkipId)}
        }
        this.collection.find(query).limit(options.m_limit).toArray()
            .then((docs) => {
                return callback(docs)
            })
            .catch((err) => {
                console.error(err);
                return this.get_docs(callback);
            })
    }

     count_docs(callback) {
        let query = {};
        if (this.mongoSkipId) {
            query["_id"] = {$gt: ObjectId(this.mongoSkipId)}
        }
        this.collection.estimatedDocumentCount(query)
            .then((count) => {
                return callback(count);
            })
            .catch((err) => {
                console.error(err);
                return this.count_docs(callback);
            })
    }
}

class ElasticAPI {
    constructor(esClient) {
        this.esClient = esClient;
    }

    insertDocs(docs, callback) {

        let body = [];
        docs.forEach((x) => {
            // action description
            body.push({index: {_index: options.e_index, _type: options.e_type, _id: x._key}});
            // the document to index

            body.push(transformDoc(x))
        });

        let _this = this;
        this.esClient.bulk({
            body: body
        }, function (err, resp) {
            if (err) {
                console.error(err.message);
                _this.esClient.indices.flush({
                    index: options.e_index
                }, function (err, resp) {
                    if (err) {
                        console.error(err.message);
                    }
                });
                return _this.insertDocs(docs, callback);

            }
            else if (resp.errors) {
                console.error(err);
                return _this.insertDocs(docs, callback);
            }
            else {
                console.info('Elastic inserted docs, took ' + resp.took + ' secs');
                return callback();
            }
        });
    }
}


function runner(mongoAPI, elasticAPI) {
    mongoAPI.get_docs((docs) => {
        if (docs.length > 0) {
            console.info('Mongo Batch Fetched');
            let lastDocId = docs[docs.length - 1]._id;
            elasticAPI.insertDocs(docs, () => {
                docsRemaining = docsRemaining - docs.length;
                console.info('Elastic Batch indexed');

                mongoAPI.mongoSkipId = lastDocId;

                console.info('Mongo next skip id to run ' + lastDocId.toString());

                return runner(mongoAPI, elasticAPI);
            })
        }
        else {
            console.info('Sync Complete\n');
            process.exit(0);
        }
    });
}
//start
if (!options.m_host || !options.m_db || !options.m_collection || !options.e_host || !options.e_index || !options.e_type) {
    console.error('Mandatory options are missing :(');
    process.exit(0);
}

options.m_limit = options.m_limit ? options.m_limit : 100;
options.thread = options.thread ? options.thread : require('os').cpus().length;
options.m_fields = options.m_fields ? options.m_fields.split(',') : null;
let docsRemaining;
MongoClient.connect(options.m_host, {useNewUrlParser: true}, function (err, client) {
    console.log("Mongo Connected successfully");

    const db = client.db(options.m_db);
    const collection = db.collection(options.m_collection);


    const esClient = new elasticsearch.Client({
        host: options.e_host,
        log: 'error'
    });

    let mongoSkipId = options.m_skip_id ? options.m_skip_id : null;
    let mongoAPI = new MongoAPI(db, collection, mongoSkipId);
    let elasticAPI = new ElasticAPI(esClient);


    runner(mongoAPI, elasticAPI);
    mongoAPI.count_docs((count) => {
        docsRemaining = count;
    });

    //print progress
    setInterval(() => {
        console.info('Docs Remaining: ' + docsRemaining);
    }, 30000);
});

