# Mongo To Elastic Dump

mongo-to-elastic-dump is a command line tool for dumping data from mongodb to elasticsearch.
  - command line tool for multi-utility
  - Feature to transform data before dumping
  - Both Insert and Update document
  - https://www.npmjs.com/package/mongo-to-elastic-dump

# New Features!
  - On Suggestions

You can also:
  - Use it as library module

### Installation

Requires [Node.js](https://nodejs.org/) v8+ to run.
Works best with mongodb v4.x and elasticsearch v6.x

```sh
$ npm install mongo-to-elastic-dump
$ npm install mongo-to-elastic-dump -g
```

### Use it as command line
```sh
$ cd /path/to/library
$ npm link
```

#### Building for source
For production release:
```sh
$ git clone https://github.com/sameer17cs/mongo-to-elastic-dump
$ cd mongo-to-elastic-dump
$ npm install
```

#### Use as tool
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
     - Example: {"dump": true}

- m_fields  ```String```
     - optional
     - Mongodb Document Fields to dump
     - Default: null (i.e. all fields)
     - comma separated string
     - Example: field1, field2, field3

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
    - Elastic index to insert/update documents

- e_type ```String```
    - mandatory
    - Elastic index type mapping

- e_doc_id ```String```
    - mandatory
    - Document Primary key
    - JSON Document key name (field name), whose value will be used as document id (_id) in elasticsearch

- e_update_key ```updatekey```  [, ```isPrimary``` ]
    - optional
    - Use when you want to update elasticsearch docs by primary key or non-primary key.
    - It is JSON Document field name, whose value will be used to match document for update.
    - ```updateKey``` key field should be present in both elasticsearch and mongodb
     - [OPTIONAL] ```isPrimary``` - default: false
                - Set ```true``` when ```updatekey``` is **THE** elasticsearch primary key. It is **faster**.
                - Set ```false``` when ```updatekey``` is **NOT** elasticsearch primary key. It is slow.
                - When false, ```updateKey``` will be searched in elasticsearch using term query. Works best when ```updateKey``` is mapped as ```keyword```


     - Options like ---m_query, -m_fields, --m_transform are valid
     - It will update multiple docs (if found)
     - If elasticsearch throws error, try setting lower value for ```m_limit```
     - Example ```--e_update_key updateKey``` | ```--e_update_key updateKey,true```


- m_transform ```relative path of transform.js```
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

INSERT SELECT FIELDS
```sh
mongo-to-elastic-dump --m_host mongodb://localhost:27017 --m_db test_db --m_collection test_coll --e_host localhost:9200 --e_index test_index --e_type test_type  --e_doc_id doc_key  --m_fields field1,field2,field3
```

INSERT TRANSFORMED DOCS
```sh
mongo-to-elastic-dump --m_host mongodb://localhost:27017 --m_db test_db --m_collection test_coll --e_host localhost:9200 --e_index test_index --e_type test_type --e_doc_id doc_key --m_transform transform.js
```

UPDATE DOCS IN ELASTIC BY GIVEN PRIMARY ```updatekey```
```sh
mongo-to-elastic-dump --m_host mongodb://localhost:27017 --m_db test_db --m_collection test_coll --e_host localhost:9200 --e_index test_index --e_update_key updatekey,true
```

UPDATE DOCS IN ELASTIC BY GIVEN NON-PRIMARY ```updatekey``` (should be mapped in elasticsearch)
```sh
mongo-to-elastic-dump --m_host mongodb://localhost:27017 --m_db test_db --m_collection test_coll --e_host localhost:9200 --e_index test_index --e_update_key updatekey
```

UPDATE DOCS IN ELASTIC BY TRANSFORM
```sh
mongo-to-elastic-dump --m_host mongodb://localhost:27017 --m_db test_db --m_collection test_coll --e_host localhost:9200 --e_index test_index --e_type test_type --e_update_key updatekey --m_transform transform.js
```



### Todos

 - Performance test

License
----

MIT
