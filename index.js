//INSERT
// node index.js --m_host mongodb://localhost:27017 --m_db profilesraw --m_collection linkedinraw --e_host 192.168.1.101:9200 --e_index test --e_type profile --m_limit 1

//UPDATE
//node index.js --m_host mongodb://localhost:27017 --m_db profilesraw --m_collection memberid-email --e_host 192.168.1.101:9200 --e_index test --e_type profile --m_limit 1 --e_update linkedin_id


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
    {name: 'm_query', type: String},
    {name: 'm_skip_id', type: String},
    {name: 'e_host', type: String},
    {name: 'e_index', type: String},
    {name: 'e_type', type: String},
    {name: 'e_update', type: String},
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
    constructor(db, collection, mongoSkipId) {
        this.db = db;
        this.collection = collection;
        this.mongoSkipId = mongoSkipId;
    }

    get_docs(callback) {
        let query = {};

        if (options.m_query) {
            query = options.m_query;
        }

        if (this.mongoSkipId) {
            query["_id"] = {$gt: ObjectId(this.mongoSkipId)}
        }
        this.collection.find(query).limit(options.m_limit).toArray()
            .then((docs) => {
                return callback(docs)
            })
            .catch((err) => {
                logging('error', err.message);
                return this.get_docs(callback);
            })
    }

    count_docs(callback) {
        let query = {};
        if (options.m_query) {
            query = options.m_query;
        }
        if (this.mongoSkipId) {
            query["_id"] = {$gt: ObjectId(this.mongoSkipId)}
        }
        this.collection.find(query).count()
            .then((count) => {
                return callback(count);
            })
            .catch((err) => {
                logging('error', err.message);
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
                logging('error', err.message);
                _this.esClient.indices.flush({
                    index: options.e_index
                }, function (err, resp) {
                    if (err) {
                        logging('error', err.message);
                    }
                });
                return _this.insertDocs(docs, callback);

            }
            else if (resp.errors) {
                logging('error', err.message);
                return _this.insertDocs(docs, callback);
            }
            else {
                logging('info', 'Elastic inserted docs, took ' + resp.took + ' secs');
                return callback();
            }
        });
    }

    updateDocs(docs, callback) {
        let _this = this;

        let allPromises = docs.map((x) => {
            return new Promise((resolve, reject) => {
                let scriptArray = [];
                for (let key in x) {
                    if (key !== '_id' && key !== options.e_update)
                        scriptArray.push(`ctx._source.${key} = '${x[key]}'`);
                }

                let query = {term: {}};
                query['term'][options.e_update] = x[options.e_update];
                this.esClient.updateByQuery({
                        index: options.e_index,
                        type: options.e_type,
                        body: {
                            "query":query,
                            "script": {"source": scriptArray.join(';')}
                        }
                    }, function (err, resp) {
                        if (err) {
                            console.error(err);
                            return reject(err);
                        }
                        else if (resp.errors) {
                            console.error(resp.errors);
                            return reject(resp.errors);
                        }
                        else {
                            return resolve()
                        }

                    }
                )
            })
        });

        Promise.all(allPromises)
            .then(() => {
                logging('info', 'Elastic updated docs batch');
                return callback();

            })
            .catch((err) => {
                logging('error', err.message);
                _this.esClient.indices.flush({
                    index: options.e_index
                }, function (err, resp) {
                    if (err) {
                        logging('error', err.message);
                    }
                });
                return _this.updateDocs(docs, callback);
            })
    }
}


function runner(mongoAPI, elasticAPI) {
    mongoAPI.get_docs((docs) => {
        if (docs.length > 0) {
            logging('debug', 'Mongo Batch Fetched');
            let lastDocId = docs[docs.length - 1]._id;

            if (options.e_update) {
                elasticAPI.updateDocs(docs, () => {
                    docsRemaining = docsRemaining - docs.length;
                    mongoAPI.mongoSkipId = lastDocId;
                    logging('info', 'Mongo next skip id to run ' + lastDocId.toString() + '\t Completed: ' + (((totalDocs - docsRemaining) / totalDocs).toFixed(2) * 100) + ' %');
                    return runner(mongoAPI, elasticAPI);
                })
            }

            else {
                elasticAPI.insertDocs(docs, () => {
                    docsRemaining = docsRemaining - docs.length;
                    mongoAPI.mongoSkipId = lastDocId;
                    logging('info', 'Mongo next skip id to run ' + lastDocId.toString() + '\t Completed: ' + (((totalDocs - docsRemaining) / totalDocs).toFixed(2) * 100) + ' %');
                    return runner(mongoAPI, elasticAPI);

                })
            }


        }
        else {
            logging('info', 'Sync Complete\n');
            process.exit(0);
        }
    });
}

//start
if (!options.m_host || !options.m_db || !options.m_collection || !options.e_host || !options.e_index || !options.e_type) {
    logging('error', 'Mandatory options are missing :(');
    process.exit(0);
}

options.m_limit = options.m_limit ? options.m_limit : 100;
options.thread = options.thread ? options.thread : require('os').cpus().length;
options.m_fields = options.m_fields ? options.m_fields.split(',') : null;
try {
    options.m_query = options.m_query ? JSON.parse(options.m_query) : null;
}
catch (e) {
    logging('error','Error in mongodb query format, expects JSON');
    process.exit(0);
}
let totalDocs, docsRemaining;
MongoClient.connect(options.m_host, {useNewUrlParser: true}, function (err, client) {
    logging('info', "Mongo Connected successfully");

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
        totalDocs = count;
        docsRemaining = count;
    });
});

function logging(level, message) {
    switch (level) {
        case 'error':
            console.error(`[${new Date().toLocaleTimeString()}] ${message}`);
            break;
        case 'info':
            console.info(`[${new Date().toLocaleTimeString()}] ${message}`);
            break;
        case 'debug':
            console.debug(`[${new Date().toLocaleTimeString()}] ${message}`);
            break;
        default:
        // code block
    }

}