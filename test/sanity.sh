#!/bin/bash

if [[ $1 == "insert" ]]
then
   node index.js --m_host mongodb://localhost:27000 --m_db backup --m_collection test_with_me --e_host localhost:9200 --e_index test --e_type test --e_doc_id _key --m_limit 1 --m_fields _key,username,country

elif [[ $1 == "update_primary" ]]
then
    node index.js --m_host mongodb://localhost:27000 --m_db backup --m_collection test_with_me --e_host localhost:9200 --e_index test --e_type test --e_update_key _key,true --m_limit 1

elif [[ $1 == "update_secondary" ]]
then
    node index.js --m_host mongodb://localhost:27000 --m_db backup --m_collection test_with_me --e_host localhost:9200 --e_index test --e_type test --e_update_key username --m_limit 1

else
    echo "Not Found"
fi