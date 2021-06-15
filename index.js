'use strict';

const MongoClient = require('mongodb').MongoClient;
const elasticsearch = require('elasticsearch');
const commandLineArgs = require('command-line-args');
const path = require('path');
const {ObjectId} = require('mongodb');
const options = commandLineArgs([
    {name: 'm_host', type: String},
    {name: 'm_db', type: String},
    {name: 'm_collection', type: String},
    {name: 'm_limit', type: Number},
    {name: 'm_fields', type: String},
    {name: 'm_query', type: String},
    {name: 'm_skip_id', type: String},
    {name: 'm_transform', type: String},
    {name: 'e_host', type: String},
    {name: 'e_index', type: String},
    {name: 'e_type', type: String},
    {name: 'e_doc_id', type: String},
    {name: 'e_update_key', type: String}
]);

class MongoAPI {
    constructor(db, collection, mongoSkipId) {
        this.db = db;
        this.collection = collection;
        this.mongoSkipId = mongoSkipId;
    }

    get_docs(callback) {
        let query = {}, projection = {};

        if (options.m_query) {
            query = options.m_query;
        }
        if (this.mongoSkipId) {
            query["_id"] = {$gt: ObjectId(this.mongoSkipId)}
        }

        if (options.m_fields) {
            options.m_fields.forEach((key) => {
                projection[key] = 1;
            });
        }
        this.collection.find(query).project(projection).limit(options.m_limit).toArray()
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
        this.versionCheck(esClient);
    }

    versionCheck(esClient) {
        esClient.info({}, (err, response) => {
            if (err) {
                process.exit('Elastic connection Failed');
            }
            else {
                this.isTypeDepricated = parseInt(response.version.number) > 6;
            }

        })
    }

    insertDocs(docs, callback) {

        let body = [];
        docs.forEach((x) => {
            let insertDescription = {_index: options.e_index, _id: x[options.e_doc_id]};
            if (!this.isTypeDepricated) {
                insertDescription['_type'] = options.e_type;
            }

            // action description
            body.push({index: insertDescription});
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
                logging('error', JSON.stringify(resp));
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
        let updateBody = [];

        //when e_update_key[0] is also the field with value of elastic doc id.
        if (options.e_update_key[1]) {
            let updateBody = [];
            docs.forEach((x) => {
                let updateDescription = {_index: options.e_index, _id: x[options.e_update_key[0]]};
                if (!_this.isTypeDepricated) {
                    updateDescription['_type'] = options.e_type
                }

                // action description
                updateBody.push({update: updateDescription});
                // the document to update
                updateBody.push({doc: transformDoc(x)});
            });

            this.esClient.bulk({
                body: updateBody
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
                    return _this.updateDocs(docs, callback);

                }
                else if (resp.errors) {
                    logging('error', JSON.stringify(resp));
                    return _this.updateDocs(docs, callback);
                }
                else {
                    logging('info', 'Elastic updated docs, took ' + resp.took + ' secs');
                    return callback();
                }
            });
        }

        //when e_update_key[0] value is different from elastic doc id.
        else {
            let searchPromises = docs.map((x) => {
                return new Promise((resolve, reject) => {

                    let searchBody = {_source: false, query: {term: {}}};
                    searchBody['query']['term'][options.e_update_key[0]] = {};
                    searchBody['query']['term'][options.e_update_key[0]]['value'] = x[options.e_update_key[0]];

                    let searchQuery = {
                        index: options.e_index,
                        body: searchBody
                    };

                    if (!_this.isTypeDepricated) {
                        searchQuery['type'] = options.e_type;
                    }
                    _this.esClient.search(searchQuery,
                        function (err, resp) {
                            if (err) {
                                return reject(err);
                            }
                            else {
                                let docsToUpdate = resp.hits.hits.length > 0 ? resp.hits.hits.map(y => y._id) : [];

                                if (docsToUpdate.length > 0) {
                                    docsToUpdate.forEach((eachUpdateId) => {
                                        let updateDescription = {_index: options.e_index, _id: eachUpdateId};
                                        if (!_this.isTypeDepricated) {
                                            updateDescription['_type'] = options.e_type
                                        }

                                        // action description
                                        updateBody.push({update: updateDescription});
                                        // the document to update
                                        updateBody.push({doc: transformDoc(x)});
                                    });
                                    return resolve();
                                }
                                else {
                                    //if no doc found, just resolve it
                                    logging('debug', `Elastic No Document found for ${options.e_update_key[0]} ${x[options.e_update_key[0]]}`);
                                    return resolve();
                                }

                            }
                        })
                })
            });

            Promise.all(searchPromises)
                .then(() => {
                    if (updateBody.length > 0) {
                        this.esClient.bulk({
                            body: updateBody
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
                                return _this.updateDocs(docs, callback);

                            }
                            else if (resp.errors) {
                                logging('error', JSON.stringify(resp));
                                return _this.updateDocs(docs, callback);
                            }
                            else {
                                logging('info', 'Elastic updated batch, took ' + resp.took + ' secs');
                                return callback();
                            }
                        });
                    }
                    else {
                        logging('info', 'Elastic no docs to update in this batch ..');
                        return callback();
                    }
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
}

function runner(mongoAPI, elasticAPI) {
    mongoAPI.get_docs((docs) => {
        if (docs.length > 0) {
            logging('debug', 'Mongo Batch Fetched');
            let lastDocId = docs[docs.length - 1]._id;

            if (options.e_update_key) {
                elasticAPI.updateDocs(docs, () => {
                    docsRemaining = docsRemaining - docs.length;
                    mongoAPI.mongoSkipId = lastDocId;
                    logging('info', 'Mongo next skip id to run ' + lastDocId.toString() + '\t Completed: ' + (((totalDocs - docsRemaining) / totalDocs) * 100).toFixed(2) + ' %');
                    return runner(mongoAPI, elasticAPI);
                })
            }

            else {
                elasticAPI.insertDocs(docs, () => {
                    docsRemaining = docsRemaining - docs.length;
                    mongoAPI.mongoSkipId = lastDocId;
                    logging('info', 'Mongo next skip id to run ' + lastDocId.toString() + '\t Completed: ' + (((totalDocs - docsRemaining) / totalDocs) * 100).toFixed(2) + ' %');
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

//Beginning of script

// validations
if (!options.m_host || !options.m_db || !options.m_collection || !options.e_host || !options.e_index || !options.e_type || !(options.e_doc_id || options.e_update_key)) {
    logging('error', 'Mandatory options are missing :(');
    process.exit(0);
}
// global
let totalDocs, docsRemaining, transformFunction;

// parse options and transform
parse_options();


// execution start
MongoClient.connect(options.m_host, {useNewUrlParser: true, useUnifiedTopology: true}, function (err, client) {
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

    mongoAPI.count_docs((count) => {
        totalDocs = count;
        docsRemaining = count;
        runner(mongoAPI, elasticAPI);
    });
});


// ---------------------------------------------------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------------------------------------------------
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

function parse_options() {
    options.m_limit = options.m_limit ? options.m_limit : 100;
    options.thread = options.thread ? options.thread : require('os').cpus().length;
    options.m_fields = options.m_fields ? options.m_fields.split(',') : null;

    if (options.e_update_key) {
        options.e_update_key = options.e_update_key.split(',');
        options.e_update_key[1] && options.e_update_key[1] === 'true' ? options.e_update_key[1] = true : options.e_update_key[1] = false;

    }

    transformFunction = options.m_transform ? require(path.join(process.cwd(), options.m_transform)).transform : function (doc) {
        return doc;
    };
    if (typeof transformFunction !== "function") {
        logging('error', 'Error in transform file/function, see Docs. Transform function should return doc');
        process.exit(0);
    }

    try {
        options.m_query = options.m_query ? JSON.parse(options.m_query) : null;
    }
    catch (e) {
        logging('error', 'Error in mongodb query format, expects JSON');
        process.exit(0);
    }
}

function transformDoc(doc) {
    delete doc._id;
    doc = transformFunction(doc);
    return doc;

}