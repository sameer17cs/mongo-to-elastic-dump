# Mongo To Elastic Dump

[![Build Status](https://travis-ci.org/joemccann/dillinger.svg?branch=master)](https://travis-ci.org/joemccann/dillinger)

mongo-to-elastic-dump is a command line tool for dumping data from mongodb to elasticsearch.
  - Fully customizable
  - Feature to transform data before dumping
  - Both Insert and Update document

# New Features!
  - Coming Soon

You can also:
  - Use it as library module

### Installation

Requires [Node.js](https://nodejs.org/) v8+ to run.

```sh
$ npm install mongo-to-elastic-dump
$ npm install mongo-to-elastic-dump -g
```

#### Building for source
For production release:
```sh
$ git clone https://github.com/sameer17cs/mongo-to-elastic-dump
$ cd mongo-to-elastic-dump
$ npm install
```

#### How To Run
Once installed, you can use it as command line tool
```sh
$ mongo-to-elastic-dump [--options]
```
Options are:
- m_host ```String```
     - mandatory
     - mongodb host uri (mongodb://uri:port)

- m_db ```String```
     - mandatory
     - mongodb database to dump from (source)

- m_collection ```String```
     - mandatory
     - mongodb collection to dump from

- m_limit ```Number```
     - optional
     - Per batch limit for mongo query
     - Default: 500

- m_query ```String```
     - optional
     - Mongodb query to extract dump
     - Default: {}
     - {"dump": true}

- m_fields  ```String```
     - optional
     - Mongodb Document Fields to dump
     - Default: null (i.e. all fields)
     - comma separated string
     - field1, field2, field3

- m_skip_id ```BSON String```
    - optional
    - Mongodb document id to start from.
    - BSON string
    - Useful when you dont want to begin dumping from start
    - If your command stops while running, you can take the next skip id to run from log (log will print next id to run)

- e_host ```String```
     - mandatory
     - Elasticsearch uri (localhost:9200)

- e_index ```String```
    - mandatory
    - Elastic index to insert/update data

- e_type ```String```
    - mandatory
    - Elastic index type mapping

- e_type ```String```
    - mandatory
    - Document field to be used as doc_id in elasticsearch

- e_update ```updatekey```
     - optional
     - If specified, only elastic update operation will be performed.
     - It will take provided key as ```updateKey``` and upsert all the fields extracted from mongodb.
     - ```updateKey``` should be present in both elasticsearch (mapping: term)   and mongodb
     - Use --m_fields to restrict fields in document
     - Update is 'update_by_query', it might be slower


- m_transform ```filename.js```
     - optional
     - filename.js should export a function named 'transform'
     - This function should transform and return the doc
     - ```'use strict';
          function transform(doc)  {
              return doc;
          }
          module.exports = {
              transform : transform
          };
       ```

##### Example

INSERT DOCS
```sh
mongo-to-elastic-dump --m_host mongodb://localhost:27017 --m_db test_db --m_collection test_coll --e_host localhost:9200 --e_index test_index --e_type test_type  --e_doc_id doc_key
```

INSERT SELECT DOCS BY MONGODB QUERY
```sh
mongo-to-elastic-dump --m_host mongodb://localhost:27017 --m_db test_db --m_collection test_coll --e_host localhost:9200 --e_index test_index --e_type test_type  --e_doc_id doc_key  --m_query '{}'
```

UPDATE DOCS IN ELASTIC BY UPDATEFIELD
```sh
mongo-to-elastic-dump --m_host mongodb://localhost:27017 --m_db test_db --m_collection test_coll --e_host localhost:9200 --e_index test_index --e_update updatekey
```

TRANSFORM DOCS
```sh
mongo-to-elastic-dump --m_host mongodb://localhost:27017 --m_db test_db --m_collection test_coll --e_host localhost:9200 --e_index test_index --e_type test_type --e_doc_id doc_key --m_transform transform.js
```

### Todos

 - Performance test

License
----

MIT

**Free Software, Hell Yeah!**
