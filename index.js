/*
  Author: Sameer Deshmukh
  Description: tool for dumping data from mongodb to elasticsearch.
*/

'use strict';

const MongoClient = require('mongodb').MongoClient;
const { Client } = require('@elastic/elasticsearch')
const path = require('path');
const { ObjectId } = require('mongodb');
const { EJSON } = require('bson');

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
  .defineString("e_auth", "tool")
  .setDefault()
  .setDescription("elasticsearch auth credentials");

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

Flags
  .defineString("e_action", "tool")
  .setDefault("index")
  .setDescription("elasticsearch action to perform on document (index/create)");

Flags.parse();

// global
let total_docs, remaining_docs, transform_func;
let elastic_api, mongo_api;
let m_fields, m_query, e_update_key;

class MongoAPI {
  constructor(collection, mongoSkipId) {
    this.collection = collection;
    this.mongoSkipId = mongoSkipId;
  }

  async getDocs() {
    if (this.mongoSkipId) {
      const queryId = (typeof this.mongoSkipId === "string")
        ? this.mongoSkipId
        : new ObjectId(this.mongoSkipId);
      m_query["_id"] = { $gt: queryId };
    }
    const projection = {};
    m_fields.forEach((key) => {
      projection[key] = 1;
    });
    try {
      const t_start = Date.now();
      const docs = await this.collection
        .find(m_query)
        .project(projection)
        .limit(Flags.get("m_limit"))
        .sort({ _id: 1 })
        .toArray();

      logging("debug", `Mongodb get batch took: ${(Date.now() - t_start)} ms`);
      return docs;
    } catch (e) {
      logging("error", `Mongodb get : ${e.message}`);
      return this.getDocs();
    }
  }

  async countDocs() {
    try {
      logging("info","Getting total count of docs from mongodb collection (may take a while depending on collection size) ...");
      let count = null;
      if (this.mongoSkipId) {
        count = await this.collection.countDocuments({_id: {$gt: ObjectId(this.mongoSkipId)}});
      } else {
        count = await this.collection.estimatedDocumentCount();
      }
      logging("info","Total docs count of docs: " + count);
      return count;
    } catch (e) {
      logging("error", e.message);
      return this.countDocs();
    }
  }
}
class ElasticAPI {
  constructor(es_client) {
    this.es_client = es_client;
  }

  async versionCheck() {
    try {
      const response = await this.es_client.info({});
      const version = parseInt(response.version.number);
      logging('info', `Elasticsearch version is ${version}`);
      if (version < 6) {
        logging('error', 'This tool doesnt support elasticsearch older than v6');
        process.exit();
      }
    }
    catch (e) {
      logging("error", e.message);
      return this.versionCheck();
    }
  }

  async insertDocs(docs) {
    const body = [];
    docs.forEach((x) => {
      const description = { _index: Flags.get("e_index"), _id: x[Flags.get("e_doc_id")] };
      // action description
      const header = {};

      header[Flags.get("e_action")] = description;
      
      body.push(header);
      
      // the document to index
      const doc = transformDoc(x);

      if (Flags.get("e_action") === "create" && !doc["@timestamp"]) {
        doc["@timestamp"] = new Date();
      }
      body.push(doc);
    });
    try {
      const resp = await this.es_client.bulk({ body: body });
      if (resp.errors) {
        logging("error", JSON.stringify(resp));
        return this.insertDocs(docs);
      }
      logging("debug", `Elasticsearch upserted batch, took ${resp.took} msecs`);
      return;
    }
    catch (e) {
      logging("error", `Elasticsearch bulk: ${err.message}`);
      this.es_client.indices.flush({ index: Flags.get("e_index") }).catch()
      return this.insertDocs(docs);
    }
  }

  async updateDocs(docs) {

    /** when e_update_key[0] is also the field with value of elastic doc id. */
    if (e_update_key[1]) {
      try {
        const update_body = [];
        docs.forEach((x) => {
          const description = { _index: Flags.get("e_index"), _id: x[e_update_key[0]] };
          update_body.push({ update: description });    // action description
          update_body.push({ doc: transformDoc(x) });   // the document to update
        });
        const resp = await this.es_client.bulk({ body: update_body });
        if (resp.errors) {
          logging("error", JSON.stringify(resp));
          return this.updateDocs(docs);
        }
        logging("info", "Elasticsearch updated batch, took " + resp.took + " secs");
        return;
      }
      catch (e) {
        logging("error",`Elasticsearch bulk: ${err.message}`);
        this.es_client.indices.flush({ index: Flags.get("e_index") }).catch();
        return this.updateDocs(docs);
      }
    }

    //when e_update_key[0] value is different from elastic doc id.
    else {
      const update_body = [];
      try {
        for (let i = 0; i < docs.length; i++) {
          const search_body = { _source: false, query: { term: {} } };
          search_body["query"]["term"][e_update_key[0]] = {};
          search_body["query"]["term"][e_update_key[0]]["value"] = docs[i][e_update_key[0]];

          const search_query = { index: Flags.get("e_index"), body: search_body };
          const resp = await this.es_client.search(search_query);
          const docs_to_update = (resp.hits.hits.length > 0) ? resp.hits.hits.map((y) => y._id) : [];
          if (docs_to_update.length == 0) {
            logging("debug", `Elasticsearch No Document found for ${e_update_key[0]} ${docs[i][e_update_key[0]]}`);
            continue;
          }
          docs_to_update.forEach((eachUpdateId) => {
            const description = { _index: Flags.get("e_index"), _id: eachUpdateId };
            update_body.push({ update: description });    // action description
            update_body.push({ doc: transformDoc(docs[i]) });   // the document to update
          });
        }

        if (update_body.length == 0) {
          logging("info", "Elasticsearch no docs to update in this batch ..");
          return;
        }

        const resp = await this.es_client.bulk({ body: update_body });
        if (resp.errors) {
          logging("error", JSON.stringify(resp));
          return this.updateDocs(docs);
        }
        logging("info", "Elasticsearch updated batch, took " + resp.took + " secs");
        return;
      }
      catch (e) {
        logging("error", `Elasticsearch bulk: ${e.message}`);
        this.es_client.indices.flush({ index: Flags.get("e_index") }).catch();
        return this.updateDocs(docs);
      }
    }
  }
}

async function runner() {
  const t_start = Date.now();
  const docs = await mongo_api.getDocs();
  if (docs.length == 0) {
    logging('info', 'Sync Complete\n');
    process.exit(0);
  }
  const lastDocId = docs[docs.length - 1]._id;

  if (e_update_key) {
    await elastic_api.updateDocs(docs);
    remaining_docs = remaining_docs - docs.length;
    mongo_api.mongoSkipId = lastDocId;
    logging('info', 'Mongodb next skip id to run ' + lastDocId.toString() + `\t took: ${(Date.now() - t_start)} ms` + '\t Completed: ' + (((total_docs - remaining_docs) / total_docs) * 100).toFixed(2) + ' %');
    runner();
    return;
  }

  await elastic_api.insertDocs(docs);
  remaining_docs = remaining_docs - docs.length;
  mongo_api.mongoSkipId = lastDocId;
  logging('info', 'Mongodb next skip id to run ' + lastDocId.toString() + `\t took: ${(Date.now() - t_start)} ms` + '\t Completed: ' + (((total_docs - remaining_docs) / total_docs) * 100).toFixed(2) + ' %');
  runner();
  return;
}

async function initMongoAPI() {
  const connectUrl = Flags.get('m_host').includes('://')
    ? Flags.get('m_host')
    : `mongodb://${Flags.get('m_host')}`;; 
  const mclient = await MongoClient.connect(connectUrl, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = mclient.db(Flags.get('m_db'));
  const collection = db.collection(Flags.get('m_collection'));
  logging("info", "Mongodb Connected successfully");
  const mongoSkipId = Flags.get("m_skip_id");
  mongo_api = new MongoAPI(collection, mongoSkipId);
  return;
}

async function initElasticsearchAPI() {
  const connectUrl = Flags.get('e_host').includes('://')
    ? Flags.get('e_host')
    : `http://${Flags.get('e_host')}`;
  const authOptions = Flags.get('e_auth') ? JSON.parse(Flags.get('e_auth')) : null;
  const es_client = new Client({ node: connectUrl, auth : authOptions, log: "error" });
  logging("info", "Elasticsearch Connected successfully");
  elastic_api = new ElasticAPI(es_client);
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
    m_query = Flags.get('m_query') ? EJSON.parse(Flags.get('m_query')) : {};
  }
  catch (e) {
    logging('error', 'Error in mongodb query format, expects JSON');
    process.exit(0);
  }
}

function logging(level, message) {
  const now = new Date();
  const options = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const formattedDateTime = formatter.format(now);

  switch (level) {
    case 'error':
      console.error(`[${formattedDateTime}] ${message}`);
      break;
    case 'info':
      console.info(`[${formattedDateTime}] ${message}`);
      break;
    case 'debug':
      console.debug(`[${formattedDateTime}] ${message}`);
      break;
    default:
    // code block
  }

}

/** Main starts from here */
async function main() {
  if (
    !Flags.get("m_host") ||
    !Flags.get("m_db") ||
    !Flags.get("m_collection") ||
    !Flags.get("e_host") ||
    !Flags.get("e_index") ||
    !(Flags.get("e_doc_id") || Flags.get("e_update_key"))
  ) {
    logging("error", "Thou Shall Not Pass without Mandatory parameters");
    process.exit(0);
  }

  /**parse options and transform */
  parseInput();
  await initMongoAPI();
  await initElasticsearchAPI();
  await elastic_api.versionCheck();
  const count = await mongo_api.countDocs();
  total_docs = count;
  remaining_docs = count;
  runner();
}

main();