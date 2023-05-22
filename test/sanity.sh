#!/bin/bash

mongouri="localhost:27017"
elasticuri="localhost:9200"
mongo_dbname="testdb"
mongo_collname="testcoll"
elastic_index="testindex"
fields="uuid,name,address"

if [[ $1 == "upsert" ]]
then
   node index.js --m_host $mongouri --m_db $mongo_dbname --m_collection $mongo_collname --e_host $elasticuri --e_index $elastic_index --e_doc_id uuid --m_limit 1

elif [[ $1 == "update_primary" ]]
then
    node index.js --m_host $mongouri --m_db $mongo_dbname --m_collection $mongo_collname --e_host $elasticuri --e_index $elastic_index --e_update_key uuid,true --m_limit 1

elif [[ $1 == "update_secondary" ]]
then
    node index.js --m_host $mongouri --m_db $mongo_dbname --m_collection $mongo_collname --e_host $elasticuri --e_index $elastic_index --e_update_key name --m_limit 1

else
    echo "Pass test argument"
fi