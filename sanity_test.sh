#!/bin/bash

if [ "$1" == "insert" ]
then
   node index.js --m_host mongodb://localhost:27017 --m_db test_db --m_collection coll_insert --e_host localhost:9200 --e_index test --e_type test --e_doc_id _key --m_limit 1 --m_fields linkedin_id,_key


elif [ "$1" == "update" -a "$2" == "primary" ]
then
    node index.js --m_host mongodb://localhost:27017 --m_db test_db --m_collection coll_insert --e_host localhost:9200 --e_index test --e_type test --e_update_key _key,true --m_limit 1


elif [ "$1" == "update" -a "$2" == "secondary" ]
then
    node index.js --m_host mongodb://localhost:27017 --m_db test_db --m_collection coll_update --e_host localhost:9200 --e_index test --e_type test --e_update_key linkedin_id --m_limit 1

else
    echo "Not Found"
fi