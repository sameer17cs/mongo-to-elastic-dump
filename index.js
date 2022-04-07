/*
  Author: Sameer Deshmukh
  Description: tool for dumping data from mongodb to elasticsearch.
*/

'use strict';

const MongoClient = require('mongodb').MongoClient;
import { Client } from "@elastic/elasticsearch";
const path = require('path');
const { ObjectId } = require('mongodb');

const Flags = require("flags");

Flags
  .defineString("m_host", "tool")
  .setDefault("localhost:27017")
  .setDescription("mongodb host uri (mongodb://uri:port)");

  Flags
  .defineString("m_db", "tool")
  .setDefault()
  .setDescription("mongodb database to dump from (source)");

  Flags
  .defineString("e_host", "tool")
  .setDefault("localhost:9200")
  .setDescription("elasticsearch uri");

  Flags
  .defineString("e_index", "tool")
  .setDefault("localhost:9200")
  .setDescription("elasticsearch index to insert/update documents");

  Flags
  .defineString("m_collection", "tool")
  .setDefault()
  .setDescription("mongodb collection to dump from");

  Flags
  .defineNumber("m_limit", "tool")
  .setDefault(500)
  .setDescription("Per batch limit for mongo query");

  Flags
  .defineString("m_fields", "tool")
  .setDefault()
  .setDescription("Mongodb Document Fields to dump, comma separated string");

  Flags
  .defineString("m_query", "tool")
  .setDefault('{}')
  .setDescription("Mongodb query to extract dump");

  Flags
  .defineString("m_skip_id", "tool")
  .setDefault(null)
  .setDescription("Mongodb document id to start from");

  Flags
  .defineString("m_transform", "tool")
  .setDefault()
  .setDescription("relative path of transform.js file, where you can transform the document");

  Flags
  .defineString("e_doc_id", "tool")
  .setDefault()
  .setDescription("json document field name, whose value will be used as primray id in elasticsearch");

  Flags
  .defineString("e_update_key", "tool")
  .setDefault()
  .setDescription("json document field name, whose value will be used to match document for update");

  Flags.parse();

  // global
let total_docs, remaining_docs, transform_func;
let elastic_api, mongo_api;
let m_fields,m_query, e_update_key;

class MongoAPI {
  constructor(collection, mongoSkipId) {
    this.collection = collection;
    this.mongoSkipId = mongoSkipId;
  }

  getDocs(callback) {
    if (this.mongoSkipId) {
      m_query["_id"] = { $gt: ObjectId(this.mongoSkipId) };
    }
    const projection = {};
    m_fields.forEach((key) => {
      projection[key] = 1;
    });
    this.collection
      .find(m_query)
      .project(projection)
      .limit(Flags.get("m_limit"))
      .toArray()
      .then((docs) => {
        return callback(docs);
      })
      .catch((err) => {
        logging("error", err.message);
        return this.getDocs(callback);
      });
  }

  countDocs(callback) {
    if (this.mongoSkipId) {
      m_query["_id"] = { $gt: ObjectId(this.mongoSkipId) };
    }
    this.collection
      .find(query)
      .count()
      .then((count) => {
        return callback(count);
      })
      .catch((err) => {
        logging("error", err.message);
        return this.countDocs(callback);
      });
  }
}

class ElasticAPI {
  constructor(esClient) {
    this.esClient = esClient;
    this.versionCheck(esClient);
  }

  async versionCheck(esClient) {
    const response = await esClient.info({});
    const deprecated = parseInt(response.version.number) > 6;
    if (deprecated) {
      logging('error', 'This tool doesnt support elasticsearch older than v6');
    }
  }

  insertDocs(docs, callback) {
    const body = [];
    docs.forEach((x) => {
      let insertDescription = {
        _index: Flags.get("e_index"),
        _id: x[Flags.get("e_doc_id")],
      };
      // action description
      body.push({ index: insertDescription });
      // the document to index
      body.push(transformDoc(x));
    });

    const _this = this;
    this.esClient.bulk(
      {
        body: body,
      },
      function (err, resp) {
        if (err) {
          logging("error", err.message);
          _this.esClient.indices.flush(
            {
              index: Flags.get("e_index"),
            },
            function (err, resp) {
              if (err) {
                logging("error", err.message);
              }
            }
          );
          return _this.insertDocs(docs, callback);
        } else if (resp.errors) {
          logging("error", JSON.stringify(resp));
          return _this.insertDocs(docs, callback);
        } else {
          logging("info", "Elastic inserted docs, took " + resp.took + " secs");
          return callback();
        }
      }
    );
  }

  updateDocs(docs, callback) {
    const _this = this;

    //when e_update_key[0] is also the field with value of elastic doc id.
    if (e_update_key[1]) {
      const updateBody = [];
      docs.forEach((x) => {
        let updateDescription = {
          _index: Flags.get("e_index"),
          _id: x[e_update_key[0]],
        };
        // action description
        updateBody.push({ update: updateDescription });
        // the document to update
        updateBody.push({ doc: transformDoc(x) });
      });

      this.esClient.bulk(
        {
          body: updateBody,
        },
        function (err, resp) {
          if (err) {
            logging("error", err.message);
            _this.esClient.indices.flush(
              {
                index: Flags.get("e_index"),
              },
              function (err, resp) {
                if (err) {
                  logging("error", err.message);
                }
              }
            );
            return _this.updateDocs(docs, callback);
          } else if (resp.errors) {
            logging("error", JSON.stringify(resp));
            return _this.updateDocs(docs, callback);
          } else {
            logging(
              "info",
              "Elastic updated docs, took " + resp.took + " secs"
            );
            return callback();
          }
        }
      );
    }

    //when e_update_key[0] value is different from elastic doc id.
    else {
      const updateBody = [];
      let searchPromises = docs.map((x) => {
        return new Promise((resolve, reject) => {
          let searchBody = { _source: false, query: { term: {} } };
          searchBody["query"]["term"][e_update_key[0]] = {};
          searchBody["query"]["term"][e_update_key[0]]["value"] =
            x[e_update_key[0]];

          let searchQuery = {
            index: Flags.get("e_index"),
            body: searchBody,
          };

          _this.esClient.search(searchQuery, function (err, resp) {
            if (err) {
              return reject(err);
            } else {
              let docsToUpdate =
                resp.hits.hits.length > 0
                  ? resp.hits.hits.map((y) => y._id)
                  : [];

              if (docsToUpdate.length > 0) {
                docsToUpdate.forEach((eachUpdateId) => {
                  let updateDescription = {
                    _index: Flags.get("e_index"),
                    _id: eachUpdateId,
                  };

                  // action description
                  updateBody.push({ update: updateDescription });
                  // the document to update
                  updateBody.push({ doc: transformDoc(x) });
                });
                return resolve();
              } else {
                //if no doc found, just resolve it
                logging(
                  "debug",
                  `Elastic No Document found for ${e_update_key[0]} ${
                    x[e_update_key[0]]
                  }`
                );
                return resolve();
              }
            }
          });
        });
      });

      Promise.all(searchPromises)
        .then(() => {
          if (updateBody.length > 0) {
            this.esClient.bulk(
              {
                body: updateBody,
              },
              function (err, resp) {
                if (err) {
                  logging("error", err.message);
                  _this.esClient.indices.flush(
                    {
                      index: Flags.get("e_index"),
                    },
                    function (err, resp) {
                      if (err) {
                        logging("error", err.message);
                      }
                    }
                  );
                  return _this.updateDocs(docs, callback);
                } else if (resp.errors) {
                  logging("error", JSON.stringify(resp));
                  return _this.updateDocs(docs, callback);
                } else {
                  logging(
                    "info",
                    "Elastic updated batch, took " + resp.took + " secs"
                  );
                  return callback();
                }
              }
            );
          } else {
            logging("info", "Elastic no docs to update in this batch ..");
            return callback();
          }
        })
        .catch((err) => {
          logging("error", err.message);
          _this.esClient.indices.flush(
            {
              index: Flags.get("e_index"),
            },
            function (err, resp) {
              if (err) {
                logging("error", err.message);
              }
            }
          );
          return _this.updateDocs(docs, callback);
        });
    }
  }
}

function runner() {
  mongo_api.get_docs((docs) => {
    if (docs.length > 0) {
      logging('debug', 'Mongo Batch Fetched');
      let lastDocId = docs[docs.length - 1]._id;

      if (e_update_key) {
        elastic_api.updateDocs(docs, () => {
          remaining_docs = remaining_docs - docs.length;
          mongo_api.mongoSkipId = lastDocId;
          logging('info', 'Mongo next skip id to run ' + lastDocId.toString() + '\t Completed: ' + (((total_docs - remaining_docs) / total_docs) * 100).toFixed(2) + ' %');
          return runner();
        })
      }

      else {
        elastic_api.insertDocs(docs, () => {
          remaining_docs = remaining_docs - docs.length;
          mongo_api.mongoSkipId = lastDocId;
          logging('info', 'Mongo next skip id to run ' + lastDocId.toString() + '\t Completed: ' + (((total_docs - remaining_docs) / total_docs) * 100).toFixed(2) + ' %');
          return runner();
        })
      }
    }
    else {
      logging('info', 'Sync Complete\n');
      process.exit(0);
    }
  });
}

async function initMongoAPI() {
  const mclient = await MongoClient.connect(Flags.get('m_host'), {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  const db = mclient.db(Flags.get('m_db'));
  const collection = db.collection(Flags.get('m_collection'));
  logging("info", "Mongo Connected successfully");
  const mongoSkipId = Flags.get("m_skip_id");
  mongo_api = new MongoAPI(db, collection, mongoSkipId);
  return;
}

async function initElasticsearchAPI() {
  const esClient = new Client({ node: elastic_uri, log: "error" });
  logging("info", "Elasticsearch Connected successfully");
  elastic_api = new ElasticAPI(esClient);
  return;
}


// ---------------------------------------------------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------------------------------------------------
function transformDoc(doc) {
  delete doc._id;
  doc = transform_func(doc);
  return doc;
}

function parseInput() {
  m_fields = Flags.get('m_fields') ? Flags.get('m_fields').split(',') : [];

  if (Flags.get('e_update_key')) {
    e_update_key = Flags.get('e_update_key').split(',');
    const isprimarykey = (e_update_key[1]) && (e_update_key[1] == 'true')
    e_update_key[1] = isprimarykey;
  }

  transform_func = Flags.get("m_transform")
    ? require(path.join(process.cwd(), Flags.get('m_transform'))).transform
    : function (doc) {
        return doc;
      };

  if (typeof transform_func !== "function") {
    logging('error', 'Error in transform file/function, see Docs. Transform function should return doc');
    process.exit(0);
  }

  try {
    m_query = Flags.get('m_query') ? JSON.parse(Flags.get('m_query')) : {};
  }
  catch (e) {
    logging('error', 'Error in mongodb query format, expects JSON');
    process.exit(0);
  }
}

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

/** Main starts from here */
async function main() {
  // validations
  if (
    Flags.get("m_host") ||
    Flags.get("m_db") ||
    Flags.get("m_collection") ||
    Flags.get("e_host") ||
    Flags.get("e_index") ||
    !(Flags.get("e_doc_id") || Flags.get("e_update_key"))
  ) {
    logging("error", "Mandatory params are missing :(");
    process.exit(0);
  }

  /**parse options and transform */
  parseInput();

  await initMongoAPI();
  await initElasticsearchAPI();

  mongo_api.count_docs((count) => {
    total_docs = count;
    remaining_docs = count;
    runner();
  });
}

main();